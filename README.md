# react-signalr

This hook is designed to be a proxy to the main [HubConnection](https://docs.microsoft.com/zh-tw/javascript/api/@microsoft/signalr/hubconnection?view=signalr-js-latest) capabilities.

## Installation

You also need @microsoft/signalr, react (>= 16.8) and rxjs (>= 6) installed in your project.

## Usage

```ts
const signalrEndpoint = 'https://...';

function MyComponent() {
  ...

  const { on } = useSignalR({
    hubUrl: signalrEndpoint,
    onComplete: (hubUrl, error) => error && alert(`SignalR: disconnected\n${hubUrl}\n${error}`),
  });
  
  useEffect(() => {
    const sub = on("ReceiveMessage").subscribe(
      (res) => console.log(res),
      (err) => console.log(err)
    );
    return () => sub.unsubscribe();
  }, [on]);

  ...
}
```

Connections are cached, it means that if you open a connection to an url, further calls to `useSignalR` with the same url will use the same connection.

When the last hook using a specific connection is unmounted, this connection is closed.

## API

### useSignalR

```ts
function useSignalR(props: SignalRHubProps): SignalRHubResult;

interface SignalRHubProps {
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

interface SignalRHubResult {
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
```
