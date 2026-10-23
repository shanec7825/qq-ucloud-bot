// Load the adapter in the host realm so it survives switching extension iframes.
export function connectWorkspaceNavigation() {
  const host=window.parent;
  try {
    if(host===window||host.location.origin!==location.origin||host.location.pathname.replace(/\/$/,'')!=='/webui/extension')return;
    if(host.document.getElementById('qq-agent-workspace-navigation'))return;
    const script=host.document.createElement('script');
    script.id='qq-agent-workspace-navigation';
    script.src=new URL('../files/ui/shell-navigation.js',location.href).href;
    const onError=()=>script.remove();
    script.addEventListener('error',onError,{once:true});
    script.addEventListener('load',()=>script.removeEventListener('error',onError),{once:true});
    host.document.head.append(script);
  } catch { /* Standalone/cross-origin views have no native extension navigation. */ }
}
