import { HubConnection, HubConnectionState, IHttpConnectionOptions } from "@microsoft/signalr";
import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { EMPTY, fromEventPattern, merge, Observable, of, throwError } from "rxjs";
import { map, share, shareReplay, switchMap } from "rxjs/operators";
import { catchError, concatMap, defaultIfEmpty, delay, retryWhen } from "rxjs/operators";

//////////////////////////////////////////////////

const cacheStore: { [key: string]: Observable<any> } = {};

function cache<T>(key: string, returnObservable: () => Observable<T>): Observable<T> {
  if (!(key in cacheStore)) {
    cacheStore[key] = returnObservable();
  }
  return cacheStore[key] as Observable<T>;
}

function invalidate(key: string) {
  delete cacheStore[key];
}

//////////////////////////////////////////////////

export function setupHubConn(
  hubUrl: string,
  hubOpt: IHttpConnectionOptions = {},
  retryCount: number = -1,
  retryDelay: number = 3000,
  onComplete: (hubUrl: string, error?: any) => void = () => {}
): Observable<HubConnection> {
  return new Observable<HubConnection>((observer) => {
    console.log(`SignalR: init ${hubUrl}`);

    const connection = new HubConnectionBuilder()
      .withUrl(hubUrl, hubOpt)
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (retryContext) => {
          console.log(`SignalR: reconnect failed ${hubUrl} ${retryContext.previousRetryCount}`);
          if (retryCount === -1 || retryContext.previousRetryCount < retryCount - 1) return retryDelay;
          else {
            // remove the connection from the cache
            onComplete(hubUrl, retryContext.retryReason);
            return null; // stop reconnecting
          }
        },
      })
      .configureLogging(LogLevel.Error)
      .build();

    // when the connection is closed
    connection.onclose((error) => {
      console.log(`SignalR: close ${hubUrl} ${error}`);
      // remove the connection from the cache
      onComplete(hubUrl, error);
      observer.complete();
    });

    // start the connection and emit to the observable when the connection is ready
    connection
      .start()
      .then(() => {
        console.log(`SignalR: start ${hubUrl}`);
        observer.next(connection);
      })
      .catch((err) => observer.error(err));

    // teardown logic will be executed when there is no subscribers left (close the connection)
    return () => {
      console.log(`SignalR: stop ${hubUrl}`);
      connection.stop();
    };
  })
    .pipe(
      retryWhen((errors) => {
        return errors.pipe(
          concatMap((e, i) => {
            console.log(`SignalR: start failed ${hubUrl} ${i}`);
            if (retryCount === -1 || i < retryCount - 1) return of(e).pipe(delay(retryDelay));
            else return throwError(e);
          })
        );
      }),
      catchError((err) => {
        // remove the connection from the cache
        onComplete(hubUrl, err);
        return EMPTY;
      })
    )
    .pipe(
      // everyone subscribing will get the same connection
      // refCount is used to complete the observable when there is no subscribers left
      shareReplay({ refCount: true, bufferSize: 1 })
    );
}

export function setupHubState(getHubConn: () => Observable<HubConnection>): Observable<HubConnectionState> {
  return getHubConn()
    .pipe(
      switchMap((connection) =>
        merge(
          of(connection.state),
          fromEventPattern((handler) => connection.onreconnected(handler)).pipe(
            map(() => HubConnectionState.Connected)
          ),
          fromEventPattern((handler) => connection.onreconnecting(handler)).pipe(
            map(() => HubConnectionState.Reconnecting)
          ),
          fromEventPattern((handler) => connection.onclose(handler)).pipe(map(() => HubConnectionState.Disconnected))
        )
      )
    )
    .pipe(defaultIfEmpty<HubConnectionState>(HubConnectionState.Disconnected))
    .pipe(
      // everyone subscribing will get the same connection
      // refCount is used to complete the observable when there is no subscribers left
      shareReplay({ refCount: true, bufferSize: 1 })
    );
}

export function setupHubFunc(getHubConn: () => Observable<HubConnection>) {
  /**
   * Utility method used to subscribe to realtime events (`HubConnection.on`, `HubConnection.off`).
   *
   * @typeparam T - The expected message type.
   * @param methodName - The name of the server method to subscribe to.
   *
   * @returns An observable that emits every time a realtime message is recieved.
   *
   * @see https://docs.microsoft.com/zh-tw/javascript/api/%40microsoft/signalr/hubconnection
   */
  function on<T>(methodName: string): Observable<T> {
    return getHubConn()
      .pipe(
        // use the connection
        switchMap((connection) =>
          // create an observable from the server events
          fromEventPattern<T>(
            (handler) => {
              console.log(`SignalR: on ${methodName}...`);
              return connection.on(methodName, handler);
            },
            (handler) => {
              console.log(`SignalR: off ${methodName}...`);
              return connection.off(methodName, handler);
            }
          )
        )
      )
      .pipe(share());
  }

  function send(methodName: string, ...args: any[]): Promise<void> {
    return new Promise((r) => getHubConn().subscribe((connection) => r(connection.send(methodName, ...args))));
  }

  function invoke<T = any>(methodName: string, ...args: any[]): Promise<T> {
    return new Promise((r) => getHubConn().subscribe((connection) => r(connection.invoke<T>(methodName, ...args))));
  }

  function stream<T>(methodName: string, ...args: any[]): Observable<T> {
    return getHubConn()
      .pipe(
        // use the connection
        switchMap(
          (connection) =>
            // create an observable from the server events
            new Observable<T>((observer) => {
              console.log(`SignalR: stream start ${methodName}...`);
              const subscription = connection.stream<T>(methodName, ...args).subscribe({
                next: (value) => observer.next(value),
                error: (err) => observer.error(err),
                complete: () => observer.complete(),
              });
              return () => {
                console.log(`SignalR: stream stop ${methodName}...`);
                subscription.dispose();
              };
            })
        )
      )
      .pipe(share());
  }

  return { on, send, invoke, stream };
}

export interface SignalRHubProps {
  /* The URL the connection will use. */
  hubUrl: string;
  /* An options object used to configure the connection. */
  hubOpt?: IHttpConnectionOptions;
  /* The maximum retry attempts. (default: -1, keep retrying) */
  retryCount?: number;
  /* The delay duration in milliseconds between retry attempts. (default: 3000) */
  retryDelay?: number;
  /* The handler that will be invoked when the connection is closed or failed to start. Optionally receives a single argument containing the error that caused the connection to close (if any). */
  onComplete?: (hubUrl: string, error?: any) => void;
}

export interface SignalRHubResult {
  /**
   * Utility method used to subscribe to realtime events (`HubConnection.on`, `HubConnection.off`).
   *
   * @typeparam T - The expected message type.
   * @param methodName - The name of the server method to subscribe to.
   *
   * @returns An observable that emits every time a realtime message is recieved.
   *
   * @see https://docs.microsoft.com/zh-tw/javascript/api/%40microsoft/signalr/hubconnection
   */
  on: <T>(methodName: string) => Observable<T>;

  /**
   * Proxy to `HubConnection.send`
   *
   * @param methodName - The name of the server method to invoke.
   * @param arg - The argument used to invoke the server method.
   *
   * @returns A promise that resolves when `HubConnection.send` would have resolved.
   *
   * @see https://docs.microsoft.com/zh-tw/javascript/api/%40microsoft/signalr/hubconnection
   */
  send: (methodName: string, ...args: any[]) => Promise<void>;

  /**
   * Proxy to `HubConnection.invoke`.
   *
   * @typeparam T - The expected response type.
   * @param methodName - The name of the server method to invoke.
   * @param arg - The argument used to invoke the server method.
   *
   * @returns A promise that resolves what `HubConnection.invoke` would have resolved.
   *
   * @see https://docs.microsoft.com/zh-tw/javascript/api/%40microsoft/signalr/hubconnection
   */
  invoke: <T = any>(methodName: string, ...args: any[]) => Promise<T>;

  /**
   * Proxy to `HubConnection.stream`.
   *
   * @typeparam T - The expected response type.
   * @param methodName - The name of the server method to invoke.
   * @param arg - The argument used to invoke the server method.
   *
   * @returns An observable that emits every time a realtime message is recieved.
   *
   * @see https://docs.microsoft.com/zh-tw/javascript/api/%40microsoft/signalr/hubconnection
   */
  stream: <T>(methodName: string, ...args: any[]) => Observable<T>;

  /**
   * An observable to get current HubConnectionState.
   *
   * @returns An observable that emits the current connection state.
   *
   * @see https://docs.microsoft.com/zh-tw/javascript/api/%40microsoft/signalr/hubconnectionstate
   */
  onState: () => Observable<HubConnectionState>;

  /**
   * An observable to get current HubConnection.
   *
   * @returns An observable that emits the current connection.
   *
   * @see https://docs.microsoft.com/zh-tw/javascript/api/%40microsoft/signalr/hubconnection
   */
  getHubConn: () => Observable<HubConnection>;
}

export function createSignalRHub({
  hubUrl,
  hubOpt = {},
  retryCount = -1,
  retryDelay = 3000,
  onComplete = () => {},
}: SignalRHubProps): SignalRHubResult {
  // console.log(`createSignalRHub: ${hubUrl}`);

  function onCompleteCallback(hubUrl: string, error?: any) {
    invalidate(hubUrl);
    invalidate(`${hubUrl}_onState`);
    onComplete(hubUrl, error);
  }

  function getHubConn() {
    return cache<HubConnection>(hubUrl, () => setupHubConn(hubUrl, hubOpt, retryCount, retryDelay, onCompleteCallback));
  }

  function onState() {
    return cache<HubConnectionState>(`${hubUrl}_onState`, () => setupHubState(getHubConn));
  }

  return { ...setupHubFunc(getHubConn), onState, getHubConn };
}
