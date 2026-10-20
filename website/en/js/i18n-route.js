(function () {
  'use strict';
  var languages=[{id:'en',name:'English',label:'Choose language'},{id:'ja',name:'日本語',label:'言語を選ぶ'},{id:'ko',name:'한국어',label:'언어 선택'}];
  var supported=languages.map(function(l){return l.id;}),key='zheshgo:language';
  function parts(path){var m=path.match(/^\/(en|ja|ko)\/(.*)$/);return {locale:m?m[1]:null,rest:m?m[2]:path.replace(/^\//,'')};}
  function target(language,url){if(supported.indexOf(language)===-1)return null;var u=new URL(url,location.href),p=parts(u.pathname);return '/'+language+'/'+(p.rest||'index.html')+u.search+u.hash;}
  window.ZheshGoLanguage={target:target,parts:parts,supported:supported};
  var current=parts(location.pathname),language=current.locale||'en',saved=null;
  try{saved=localStorage.getItem(key);}catch(e){}
  if(!current.locale){
    var proposed=supported.indexOf(saved)!==-1?saved:null;
    if(!proposed){var preferences=navigator.languages||[navigator.language];for(var i=0;i<preferences.length;i++){var candidate=String(preferences[i]).toLowerCase().split('-')[0];if(supported.indexOf(candidate)!==-1){proposed=candidate;break;}}}
    if(proposed&&proposed!=='en'){location.replace(target(proposed,location.href));return;}
  }
  document.addEventListener('DOMContentLoaded',function(){setTimeout(function(){
    var header=document.querySelector('#site-header .header-inner');if(!header||header.querySelector('.language-picker'))return;
    var label=document.createElement('label');label.className='language-picker';
    var title=document.createElement('span');title.className='sr-only';title.textContent=languages.filter(function(l){return l.id===language;})[0].label;
    var select=document.createElement('select');select.setAttribute('aria-label',title.textContent);
    languages.forEach(function(l){var o=document.createElement('option');o.value=l.id;o.textContent=l.name;o.selected=l.id===language;select.appendChild(o);});
    select.addEventListener('change',function(){try{localStorage.setItem(key,select.value);}catch(e){}location.assign(target(select.value,location.href));});
    label.appendChild(title);label.appendChild(select);header.appendChild(label);
  },0);});
})();