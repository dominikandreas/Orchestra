import React,{useState,useEffect,useRef,useCallback} from 'react';
import {Mic,MicOff} from 'lucide-react';
import {cx} from './lib';

function getSpeechRecognition():any{
 if(typeof window==='undefined')return null;
 return (window as any).SpeechRecognition||(window as any).webkitSpeechRecognition||null;
}

export function useVoiceInput(onTranscript:(text:string)=>void){
 const [listening,setListening]=useState(false);
 const [interim,setInterim]=useState('');
 const [error,setError]=useState('');
 const recRef=useRef<any>(null);
 const callbackRef=useRef(onTranscript);
 callbackRef.current=onTranscript;

 const supported=Boolean(getSpeechRecognition());

 const stop=useCallback(()=>{
  try{recRef.current?.stop();}catch{}
  setListening(false);
  setInterim('');
 },[]);

 const toggle=useCallback(()=>{
  const SR=getSpeechRecognition();
  if(!SR){
   setError('Speech recognition is not supported in this browser.');
   return;
  }
  if(listening){
   stop();
   return;
  }
  setError('');
  try{
   const rec=new SR();
   rec.continuous=true;
   rec.interimResults=true;
   rec.lang=navigator.language||'en-US';
   rec.onresult=(event:any)=>{
    let finalChunk='';
    let interimChunk='';
    for(let i=event.resultIndex;i<event.results.length;i++){
     const res=event.results[i];
     const t=res[0]?.transcript||'';
     if(res.isFinal)finalChunk+=t;
     else interimChunk+=t;
    }
    if(finalChunk.trim()){
     callbackRef.current(finalChunk.trim());
    }
    setInterim(interimChunk.trim());
   };
   rec.onerror=(e:any)=>{
    if(e?.error&&e.error!=='aborted'&&e.error!=='no-speech'){
     setError(`Voice input error: ${e.error}`);
    }
    setListening(false);
    setInterim('');
   };
   rec.onend=()=>{
    setListening(false);
    setInterim('');
   };
   recRef.current=rec;
   rec.start();
   setListening(true);
  }catch(err){
   setError((err as Error).message||'Could not start voice input');
   setListening(false);
  }
 },[listening,stop]);

 useEffect(()=>()=>{try{recRef.current?.abort();}catch{}},[]);

 return {supported,listening,interim,error,toggle,stop};
}

export function VoiceButton({onTranscript,disabled,className}:{onTranscript:(text:string)=>void,disabled?:boolean,className?:string}){
 const {supported,listening,interim,error,toggle}=useVoiceInput(onTranscript);
 return (
  <span className="voice-wrap">
   <button
    type="button"
    disabled={disabled}
    onClick={toggle}
    className={cx('chip','voice-btn',listening&&'recording',className)}
    title={!supported?'Voice input unavailable in this browser':listening?'Stop voice dictation':'Dictate with voice'}
    aria-label={listening?'Stop voice input':'Start voice input'}
   >
    {listening?<MicOff size={13}/>:<Mic size={13}/>}
    <span>{listening?(interim?`“${interim.slice(-28)}”`:'Listening…'):'Voice'}</span>
   </button>
   {error&&<span className="voice-err" title={error}>!</span>}
  </span>
 );
}
