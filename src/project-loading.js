// A navigation owns one request. Cancellation is advisory; identity/version
// checks also reject transports (and File.text()) that finish after cancellation.
export function createProjectLoading(editVersion=()=>0){
 let generation=0,active=null;
 return {
  begin(){active?.controller.abort();const controller=new AbortController();active={generation:++generation,editVersion:editVersion(),controller,signal:controller.signal};return active;},
  isCurrent(ticket){return Boolean(ticket&&active===ticket&&!ticket.signal.aborted);},
  hasNewEdits(ticket){return ticket?.editVersion!==editVersion();},
  cancel(){active?.controller.abort();active=null;generation++;},
  get generation(){return generation;},
 };
}
