// Runs in NapCat's browsing context, independent of a plugin iframe's lifetime.
(() => {
  if(window.__qqAgentWorkspaceNavigation)return;
  window.__qqAgentDownloadCalendar = function(ics, filename) {
    if (typeof ics !== 'string' || ics.length > 64000 || !ics.startsWith('BEGIN:VCALENDAR\r\n') || typeof filename !== 'string' || !/^todo-[a-f0-9]{32}\.ics$/.test(filename)) throw new Error('日历文件无效。');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const keys=new Set(['napcat-plugin-qq-agent','napcat-plugin-agent-speech','napcat-plugin-agent-github','napcat-plugin-agent-drive','napcat-plugin-agent-ucloud','napcat-plugin-agent-notices'].map(id=>id+':settings'));
  const inExtensions=()=>location.pathname.replace(/\/$/,'')==='/webui/extension';
  const style=document.createElement('style');
  style.textContent='button[data-qq-agent-tab] { min-height:44px; border-radius:10px; } button[data-qq-agent-tab][aria-selected="true"] { box-shadow:inset 0 -2px #db2777; } button[data-qq-agent-tab] [data-slot="tabContent"]>div>span+span { display:none; }';
  document.head.append(style);
  function decorate(){
    if(!inExtensions())return;
    const tabs=[...document.querySelectorAll('button[role="tab"][data-key]')];
    for(const tab of tabs)if(keys.has(tab.dataset.key)){
      tab.dataset.qqAgentTab='';
      const title=tab.querySelector('span[title]');
      if(title?.title.includes('新窗口'))title.title='切换到'+title.textContent;
    }
    const key=location.hash.slice(1),target=tabs.find(tab=>tab.dataset.key===key);
    if(keys.has(key)&&target){history.replaceState(history.state,'',location.pathname+location.search);if(target.getAttribute('aria-selected')!=='true')target.click();}
  }
  function capture(event){
    if(!inExtensions())return;
    const tab=event.target?.closest?.('button[role="tab"][data-key]');
    if(!tab||event.target===tab||!keys.has(tab.dataset.key))return;
    event.preventDefault();event.stopImmediatePropagation();tab.click();
  }
  document.addEventListener('click',capture,true);
  window.addEventListener('hashchange',decorate);
  const observer=new MutationObserver(decorate);
  observer.observe(document.body,{childList:true,subtree:true});
  window.__qqAgentWorkspaceNavigation=true;
  decorate();
})();
