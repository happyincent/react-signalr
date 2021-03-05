import { useEffect, useRef, useState } from "react";
import { createSignalRHub, SignalRHubProps, SignalRHubResult } from "./rxjs-signalr/src/index";

export function useSignalR(props: SignalRHubProps): SignalRHubResult {
  // console.log(`useSignalR: ${props.hubUrl}`);

  const [hub, set_hub] = useState(() => createSignalRHub(props));
  const hubProps = useRef(props);

  useEffect(() => {
    // create a new hub connection if props.hubUrl changes
    if (hubProps.current.hubUrl === props.hubUrl) return;
    hubProps.current = props;
    set_hub(createSignalRHub(props));
  }, [props]);

  useEffect(() => {
    // used to maintain 1 active subscription while the hook is rendered
    const sub = hub.getHubConn().subscribe();
    return () => sub.unsubscribe();
  }, [hub]);

  return hub;
}
