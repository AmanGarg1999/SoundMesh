var lt=Object.defineProperty;var dt=(s,t,e)=>t in s?lt(s,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):s[t]=e;var q=(s,t,e)=>dt(s,typeof t!="symbol"?t+"":t,e);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))i(n);new MutationObserver(n=>{for(const a of n)if(a.type==="childList")for(const o of a.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&i(o)}).observe(document,{childList:!0,subtree:!0});function e(n){const a={};return n.integrity&&(a.integrity=n.integrity),n.referrerPolicy&&(a.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?a.credentials="include":n.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function i(n){if(n.ep)return;n.ep=!0;const a=e(n);fetch(n.href,a)}})();class L{constructor(){this._listeners={}}on(t,e){return(this._listeners[t]=this._listeners[t]||[]).push(e),this}off(t,e){const i=this._listeners[t];return i&&(this._listeners[t]=i.filter(n=>n!==e)),this}emit(t,...e){(this._listeners[t]||[]).forEach(i=>i(...e))}once(t,e){const i=(...n)=>{e(...n),this.off(t,i)};return this.on(t,i)}}function Y(s){return{iPhone:"📱",iPad:"📱",Android:"📱",macOS:"💻",Windows:"🖥️",Linux:"🐧"}[s]||"📱"}function ut(s){const t={in_sync:"#00e676",drifting:"#ff9100",out_of_sync:"#ff1744",unknown:"#666"};return t[s]||t.unknown}function ht(s){const t=new Int16Array(s.length);for(let e=0;e<s.length;e++){const i=Math.max(-1,Math.min(1,s[e]));t[e]=i<0?i*32768:i*32767}return t}function pt(s){const t=new Float32Array(s.length);for(let e=0;e<s.length;e++)t[e]=s[e]/(s[e]<0?32768:32767);return t}const P=48e3,G=2,$=20,H=P*$/1e3,N=16,ft=500,X=16,mt=32,gt=3,yt=15,vt=150,bt=.1,xt=.005,K=.03,wt=20,St=200,kt=60,Ct=10,At=.005,J=5,It=1e3,z={FL:{label:"Front Left",x:20,y:20,channel:0},FC:{label:"Front Center",x:50,y:15,channel:2},FR:{label:"Front Right",x:80,y:20,channel:1},SL:{label:"Side Left",x:10,y:50,channel:4},SR:{label:"Side Right",x:90,y:50,channel:5},RL:{label:"Rear Left",x:25,y:80,channel:6},RC:{label:"Rear Center",x:50,y:85,channel:7},RR:{label:"Rear Right",x:75,y:80,channel:3},SUB:{label:"Subwoofer",x:50,y:50,channel:8}},Et={"2.0":["FL","FR"],"5.1":["FL","FC","FR","SL","SR","SUB"],"7.1":["FL","FC","FR","SL","SR","RL","RR","SUB"]};class Tt extends L{constructor(){super(),this.ws=null,this.connected=!1,this.reconnectAttempts=0,this.deviceId=localStorage.getItem("soundmesh_device_id"),this.role=null}connect(){if(this.ws&&this.ws.readyState===WebSocket.OPEN)return;const e=`${window.location.protocol==="https:"?"wss:":"ws:"}//${window.location.host}/ws`;console.log(`[WSClient] Connecting to ${e}...`),this.ws=new WebSocket(e),this.ws.binaryType="arraybuffer",this.ws.onopen=()=>{console.log("[WSClient] Connected"),this.connected=!0,this.reconnectAttempts=0,this.emit("connected");const i=window.location.hostname==="localhost"||window.location.hostname==="127.0.0.1"?"host":"node";this.send("register",{deviceId:this.deviceId,roleIntent:i,name:localStorage.getItem("soundmesh_device_name")})},this.ws.onmessage=i=>{if(i.data instanceof ArrayBuffer)this.emit("audio_data",i.data);else try{const n=JSON.parse(i.data);this.handleMessage(n)}catch(n){console.error("[WSClient] Invalid JSON:",n)}},this.ws.onclose=i=>{console.log(`[WSClient] Disconnected (code: ${i.code})`),this.connected=!1,this.emit("disconnected",i),this.attemptReconnect()},this.ws.onerror=i=>{console.error("[WSClient] Error:",i),this.emit("error",i)}}handleMessage(t){switch(t.type){case"welcome":this.deviceId=t.payload.deviceId,this.role=t.payload.role,localStorage.setItem("soundmesh_device_id",this.deviceId),t.payload.name&&localStorage.setItem("soundmesh_device_name",t.payload.name),console.log(`[WSClient] Assigned as ${this.role} (ID: ${this.deviceId})`),this.emit("welcome",t.payload);break;default:this.emit(t.type,t.payload);break}}send(t,e={}){this.connected&&this.ws.send(JSON.stringify({type:t,payload:e}))}sendBinary(t){this.connected&&this.ws.send(t)}attemptReconnect(){if(this.reconnectAttempts>=J){console.log("[WSClient] Max reconnection attempts reached"),this.emit("reconnect_failed");return}const t=It*Math.pow(2,this.reconnectAttempts);this.reconnectAttempts++,console.log(`[WSClient] Reconnecting in ${t}ms (attempt ${this.reconnectAttempts}/${J})`),setTimeout(()=>this.connect(),t)}disconnect(){this.ws&&(this.ws.close(),this.ws=null)}get isHost(){return this.role==="host"}get isNode(){return this.role==="node"}}const x=new Tt;class Pt extends L{constructor(){super();q(this,"handlePong",e=>{const i=performance.timeOrigin+performance.now(),{clientSendTime:n,serverReceiveTime:a,serverSendTime:o,globalBuffer:l}=e,c=i-n,u=(a-n+(o-i))/2;(c<this.minRtt*1.5||this.minRtt===1/0)&&(c<this.minRtt&&(this.minRtt=c),this.offsetSamples.push(u),this.history.push({t:i,offset:u}),this.lastSyncTime=i,this.offsetSamples.length>X&&this.offsetSamples.shift(),this.history.length>mt&&this.history.shift(),this.estimateSkew()),this.rttSamples.push(c),this.rttSamples.length>X&&this.rttSamples.shift();const d=this.rttSamples.reduce((y,b)=>y+b,0)/this.rttSamples.length,h=this.offsetSamples.reduce((y,b)=>y+b,0)/this.offsetSamples.length;this.offset=h,this.globalBuffer=l||this.globalBuffer;const r=this.offsetSamples.length>1?Math.sqrt(this.offsetSamples.reduce((y,b)=>y+Math.pow(b-h,2),0)/(this.offsetSamples.length-1)):0;let p="in_sync";r>yt?p="out_of_sync":r>gt&&(p="drifting"),this.syncStatus=p,this.stats={avgRtt:d,avgOffset:h,skewPpm:(this.skew*1e6).toFixed(2),offsetVariance:r},this.emit("sync_update",{offset:this.offset,skew:this.skew,rtt:d,status:this.syncStatus,globalBuffer:this.globalBuffer})});this.offset=0,this.skew=0,this.rttSamples=[],this.offsetSamples=[],this.history=[],this.minRtt=1/0,this.lastSyncTime=0,this.globalBuffer=vt,this.syncStatus="unknown",this.intervalId=null,this.isRunning=!1,this.stats={avgRtt:0,avgOffset:0,skewPpm:0,offsetVariance:0}}start(){this.isRunning||(this.isRunning=!0,x.on("sync_pong",e=>this.handlePong(e)),x.on("global_buffer_update",e=>{this.globalBuffer=e.globalBuffer}),this.sendPing(),this.intervalId=setInterval(()=>this.sendPing(),ft),console.log("[ClockSync] Started with Predictive Modeling"))}stop(){this.isRunning=!1,this.intervalId&&(clearInterval(this.intervalId),this.intervalId=null)}sendPing(){x.connected&&x.send("sync_ping",{clientSendTime:performance.timeOrigin+performance.now()})}estimateSkew(){if(this.history.length<5)return;const e=this.history.length;let i=0,n=0,a=0,o=0;const l=this.history[0].t;for(const u of this.history){const d=u.t-l,h=u.offset;i+=d,n+=h,a+=d*h,o+=d*d}const c=e*o-i*i;c!==0&&(this.skew=(e*a-i*n)/c)}getSharedTime(){const e=performance.timeOrigin+performance.now(),i=e-this.lastSyncTime,n=this.offset+this.skew*i;return e+n}toLocalTime(e){const n=performance.timeOrigin+performance.now()-this.lastSyncTime,a=this.offset+this.skew*n;return e-a-performance.timeOrigin}toSharedTime(e){const i=performance.timeOrigin+e,n=i-this.lastSyncTime,a=this.offset+this.skew*n;return i+a}getStatus(){return this.syncStatus}getStats(){return this.stats}getGlobalBuffer(){return this.globalBuffer}}const C=new Pt;class Mt extends L{constructor(){super(),this.audioContext=null,this.mediaStream=null,this.sourceNode=null,this.workletNode=null,this.isCapturing=!1,this.source=null,this.sequenceNumber=0,this.fileBuffer=null,this.fileSourceNode=null,this.isFilePlaying=!1}async init(){if(!this.audioContext){this.audioContext=new AudioContext({sampleRate:P});try{await this.audioContext.audioWorklet.addModule("/worklets/captureWorklet.js"),console.log("[AudioCapture] Capture worklet loaded")}catch(t){console.error("[AudioCapture] Failed to load capture worklet:",t)}this.analyserNode=this.audioContext.createAnalyser(),this.analyserNode.fftSize=2048,this.analyserNode.smoothingTimeConstant=.8,console.log("[AudioCapture] Initialized, sample rate:",this.audioContext.sampleRate)}}async startSystemCapture(){await this.init(),this.stop();try{this.mediaStream=await navigator.mediaDevices.getDisplayMedia({video:!0,audio:!0}),this.audioContext.state==="suspended"&&await this.audioContext.resume();const t=this.mediaStream.getVideoTracks()[0];t&&t.stop();const e=this.mediaStream.getAudioTracks()[0];if(!e)throw new Error('No audio track found. Please restart and ensure the "Share audio" checkbox is checked in the bottom-left of the selection dialog.');e.onended=()=>{console.log("[AudioCapture] Audio track ended"),this.stop(),this.emit("capture_stopped",{reason:"track_ended"})},this.sourceNode=this.audioContext.createMediaStreamSource(this.mediaStream),this.setupProcessingPipeline(this.sourceNode),this.isCapturing=!0,this.source="system",this.sequenceNumber=0,console.log("[AudioCapture] System audio capture started"),this.emit("capture_started",{source:"system"})}catch(t){throw console.error("[AudioCapture] Failed to capture system audio:",t),this.emit("capture_error",{source:"system",error:t.message||'Failed to capture. Check "Share audio" option.'}),t}}async startMicCapture(){await this.init(),this.stop();try{this.mediaStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:G,sampleRate:P,autoGainControl:!1,echoCancellation:!1,noiseSuppression:!1}}),this.sourceNode=this.audioContext.createMediaStreamSource(this.mediaStream),this.setupProcessingPipeline(this.sourceNode),this.isCapturing=!0,this.source="microphone",this.sequenceNumber=0,console.log("[AudioCapture] Microphone capture started"),this.emit("capture_started",{source:"microphone"})}catch(t){throw console.error("[AudioCapture] Mic capture failed:",t),this.emit("capture_error",{source:"microphone",error:t.message}),t}}async startFilePlayback(t){await this.init(),this.stop();try{const e=await t.arrayBuffer();this.fileBuffer=await this.audioContext.decodeAudioData(e),this.fileSourceNode=this.audioContext.createBufferSource(),this.fileSourceNode.buffer=this.fileBuffer,this.fileSourceNode.loop=!1,this.fileSourceNode.onended=()=>{this.isFilePlaying=!1,this.emit("file_ended")},this.setupProcessingPipeline(this.fileSourceNode);const i=C.getGlobalBuffer()/1e3,n=this.audioContext.createDelay(i+.1);n.delayTime.value=i,this.fileSourceNode.connect(n),n.connect(this.audioContext.destination),this.fileSourceNode.start(),this.isFilePlaying=!0,this.isCapturing=!0,this.source="file",this.sequenceNumber=0,console.log("[AudioCapture] File playback started:",t.name),this.emit("capture_started",{source:"file",fileName:t.name,duration:this.fileBuffer.duration})}catch(e){throw console.error("[AudioCapture] File playback failed:",e),this.emit("capture_error",{source:"file",error:e.message}),e}}setupProcessingPipeline(t){this.workletNode&&this.workletNode.disconnect(),this.workletNode=new AudioWorkletNode(this.audioContext,"capture-worklet"),this.workletNode.port.onmessage=i=>{if(i.data.type==="audio_chunk"){const{samples:n}=i.data,a=ht(n);this.emit("audio_chunk",{seq:this.sequenceNumber++,pcmData:a,sampleRate:P,channels:G})}},this.workletNode.port.postMessage({type:"start"});const e=this.audioContext.createGain();e.gain.value=0,t.connect(this.workletNode),this.workletNode.connect(this.analyserNode),this.analyserNode.connect(e),e.connect(this.audioContext.destination)}getAnalyser(){return this.analyserNode}stop(){if(this.isCapturing=!1,this.fileSourceNode){try{this.fileSourceNode.stop()}catch{}this.fileSourceNode=null}this.workletNode&&(this.workletNode.port.postMessage({type:"stop"}),this.workletNode.disconnect(),this.workletNode=null),this.sourceNode&&(this.sourceNode.disconnect(),this.sourceNode=null),this.mediaStream&&(this.mediaStream.getTracks().forEach(t=>t.stop()),this.mediaStream=null),this.source=null,this.isFilePlaying=!1}getState(){return{isCapturing:this.isCapturing,source:this.source,sequenceNumber:this.sequenceNumber}}}const I=new Mt;class Lt extends L{constructor(){super();q(this,"handleChunk",e=>{if(!x.connected)return;const{seq:i,pcmData:n}=e;if(this.baseSequence===null){this.baseSequence=i;const o=this.useOpus?20:0;this.baseSharedTime=C.getSharedTime()+C.getGlobalBuffer()+o}const a=this.baseSharedTime+(i-this.baseSequence)*$;if(this.useOpus&&this.encoder&&this.encoder.state==="configured")try{const o=Math.round(a*1e3);this.seqMap.set(o,i);const l=new AudioData({format:"s16",sampleRate:I.audioContext.sampleRate,numberOfChannels:2,numberOfFrames:n.length/2,timestamp:o,data:n});this.encoder.encode(l),l.close();return}catch(o){console.error("[AudioStreamer] Encode failed, falling back to PCM:",o),this.useOpus=!1}this.sendPacket(i,a,n.buffer,0)});this.isStreaming=!1,this.chunksSent=0,this.bytesSent=0,this.baseSharedTime=null,this.baseSequence=null,this.useOpus=!1,this.encoder=null,this.seqMap=new Map}start(){this.isStreaming||(I.on("audio_chunk",this.handleChunk),this.isStreaming=!0,this.chunksSent=0,this.bytesSent=0,this.chunksSent=0,this.bytesSent=0,this.baseSharedTime=null,this.baseSequence=null,this.useOpus&&this.initEncoder(),console.log(`[AudioStreamer] Started (Mode: ${this.useOpus?"Opus":"PCM"})`),this.emit("streaming_started"))}async initEncoder(){try{this.encoder=new AudioEncoder({output:(n,a)=>this.handleEncodedChunk(n,a),error:n=>{console.error("[AudioStreamer] Encoder error:",n),this.useOpus=!1}});const e={codec:"opus",sampleRate:I.audioContext.sampleRate,numberOfChannels:2,bitrate:64e3},{supported:i}=await AudioEncoder.isConfigSupported(e);i?(this.encoder.configure(e),console.log("[AudioStreamer] Opus encoder configured at 64kbps")):(console.warn("[AudioStreamer] Opus not supported, using PCM fallback"),this.useOpus=!1)}catch(e){console.error("[AudioStreamer] Failed to init encoder:",e),this.useOpus=!1}}stop(){I.off("audio_chunk",this.handleChunk),this.isStreaming=!1,console.log(`[AudioStreamer] Stopped. Sent ${this.chunksSent} chunks (${(this.bytesSent/1048576).toFixed(1)}MB)`),this.emit("streaming_stopped")}handleEncodedChunk(e,i){const n=e.timestamp/1e3,a=this.seqMap.get(e.timestamp)||0;this.seqMap.delete(e.timestamp),this.sendPacket(a,n,e.data,2)}sendPacket(e,i,n,a){const o=new ArrayBuffer(N+n.byteLength),l=new DataView(o);l.setUint32(0,e,!0),l.setFloat64(4,i,!0),l.setUint16(12,3,!0),l.setUint16(14,a,!0),new Uint8Array(o,N).set(new Uint8Array(n)),x.sendBinary(o),this.chunksSent++,this.bytesSent+=o.byteLength,this.emit("chunk_sent",{seq:e,targetPlayTime:i,bytes:o.byteLength,totalChunks:this.chunksSent})}getStats(){return{isStreaming:this.isStreaming,chunksSent:this.chunksSent,bytesSent:this.bytesSent}}}const T=new Lt;class Bt{constructor(){this.buffer=[],this.targetDepthMs=kt,this.maxDepthMs=St,this.minDepthMs=wt,this.arrivalTimes=[],this.gapCount=0,this.duplicateCount=0,this.lastSeq=-1,this.totalReceived=0}add(t){if(this.totalReceived++,this.arrivalTimes.push(performance.now()),this.arrivalTimes.length>50&&this.arrivalTimes.shift(),this.buffer.some(n=>n.seq===t.seq)){this.duplicateCount++;return}this.lastSeq>=0&&t.seq>this.lastSeq+1&&(this.gapCount+=t.seq-this.lastSeq-1),this.lastSeq=Math.max(this.lastSeq,t.seq);let e=!1;for(let n=this.buffer.length-1;n>=0;n--)if(this.buffer[n].seq<t.seq){this.buffer.splice(n+1,0,t),e=!0;break}e||this.buffer.unshift(t),this.adaptDepth();const i=Math.ceil(this.maxDepthMs/$);for(;this.buffer.length>i;)this.buffer.shift()}peek(){return this.buffer.length>0?this.buffer[0]:null}pop(){return this.buffer.shift()||null}size(){return this.buffer.length}depthMs(){return this.buffer.length*$}adaptDepth(){if(this.arrivalTimes.length<10)return;const t=[];for(let n=1;n<this.arrivalTimes.length;n++)t.push(this.arrivalTimes[n]-this.arrivalTimes[n-1]);const e=t.reduce((n,a)=>n+a,0)/t.length;Math.sqrt(t.reduce((n,a)=>n+Math.pow(a-e,2),0)/t.length)>Ct?this.targetDepthMs=Math.min(this.maxDepthMs,this.targetDepthMs+5):this.targetDepthMs=Math.max(this.minDepthMs,this.targetDepthMs-.5)}getStats(){return{depth:this.buffer.length,depthMs:this.depthMs(),targetDepthMs:this.targetDepthMs,gapCount:this.gapCount,duplicateCount:this.duplicateCount,totalReceived:this.totalReceived}}clear(){this.buffer=[],this.arrivalTimes=[],this.gapCount=0,this.duplicateCount=0,this.lastSeq=-1}}class Nt extends L{constructor(){super(),this.audioContext=null,this.gainNode=null,this.analyserNode=null,this.jitterBuffer=new Bt,this.isPlaying=!1,this.volume=1,this.muted=!1,this.nextScheduledTime=0,this.outputLatency=.04,this.localDelayOffset=0,this.schedulerInterval=null,this.chunksPlayed=0,this.lastScheduledSeq=-1,this.isFirstChunk=!0,this.driftIntegral=0,this.useOpus=!!window.AudioDecoder,this.decoder=null,this.seqMap=new Map,this.wakeLock=null,this.schedulerWorker=null,this.syncDrift=0,this.outputLatency=0,this.surroundMask="all",this.spatialDelayMs=0,this.calibrationOffsetMs=0}async init(){this.audioContext||(this.audioContext=new AudioContext({sampleRate:P}),this.gainNode=this.audioContext.createGain(),this.gainNode.gain.value=this.volume,this.gainNode.connect(this.audioContext.destination),this.analyserNode=this.audioContext.createAnalyser(),this.analyserNode.fftSize=2048,this.analyserNode.connect(this.gainNode),this.outputLatency=this.audioContext.outputLatency||0,this.audioContext.baseLatency&&(this.outputLatency+=this.audioContext.baseLatency),console.log(`[AudioPlayer] Initialized. Output latency: ${(this.outputLatency*1e3).toFixed(1)}ms`))}async initDecoder(){try{this.decoder=new AudioDecoder({output:i=>this.handleDecodedData(i),error:i=>{console.error("[AudioPlayer] Decoder error:",i),this.useOpus=!1}});const t={codec:"opus",sampleRate:P,numberOfChannels:2},{supported:e}=await AudioDecoder.isConfigSupported(t);e?(this.decoder.configure(t),console.log("[AudioPlayer] Opus decoder initialized")):(console.warn("[AudioPlayer] Opus decoding not supported by browser"),this.useOpus=!1)}catch(t){console.error("[AudioPlayer] Failed to init decoder:",t),this.useOpus=!1}}setVolume(t){this.volume=Math.max(0,Math.min(1,t)),this.gainNode&&this.audioContext&&this.gainNode.gain.setTargetAtTime(this.volume,this.audioContext.currentTime,.05)}updateSurroundState(t){if(!t||t==="unassigned"){this.surroundMask="all",this.spatialDelayMs=0;return}const{label:e,x:i,y:n,channel:a}=t;[0,4,6].includes(a)?this.surroundMask="left":[1,3,5].includes(a)?this.surroundMask="right":a===2||a===7?this.surroundMask="center":a===8?this.surroundMask="lfe":this.surroundMask="all";const c=Math.sqrt(Math.pow((i-50)/10,2)+Math.pow((n-55)/10,2));this.spatialDelayMs=c/343*1e3,console.log(`[AudioPlayer] Surround updated: ${e}. Mask: ${this.surroundMask}, Delay: +${this.spatialDelayMs.toFixed(1)}ms`)}setCalibrationOffset(t){this.calibrationOffsetMs=t,console.log(`[AudioPlayer] Calibration offset set to ${t}ms`)}async start(){if(await this.init(),this.audioContext.state==="suspended"&&await this.audioContext.resume(),this.useOpus&&(console.log("[AudioPlayer] Waiting for Opus decoder to configure..."),await this.initDecoder()),this.isPlaying=!0,this.chunksPlayed=0,this.nextScheduledTime=0,this.isFirstChunk=!0,this.schedulerWorker||(this.schedulerWorker=new Worker(new URL("/assets/scheduler.worker-Be9-34-3.js",import.meta.url),{type:"module"}),this.schedulerWorker.onmessage=()=>{this.isPlaying&&this.scheduleBuffers()}),this.schedulerWorker.postMessage({action:"start",interval:20}),this.initBackgroundAudio(),this.setupMediaSession(),"wakeLock"in navigator)try{this.wakeLock=await navigator.wakeLock.request("screen"),console.log("[AudioPlayer] Wake Lock active")}catch(t){console.warn("[AudioPlayer] Wake Lock failed:",t)}console.log("[AudioPlayer] Started"),this.emit("playback_started")}stop(){this.isPlaying=!1,this.schedulerWorker&&this.schedulerWorker.postMessage({action:"stop"}),this.backgroundAudio&&this.backgroundAudio.pause(),navigator.mediaSession&&(navigator.mediaSession.playbackState="paused"),this.jitterBuffer.clear(),this.localDelayOffset=0,this.driftIntegral=0,this.isFirstChunk=!0,this.nextScheduledTime=0,this.wakeLock&&this.wakeLock.release().then(()=>{this.wakeLock=null}),console.log(`[AudioPlayer] Stopped. Played ${this.chunksPlayed} chunks`),this.emit("playback_stopped")}receiveChunk(t){if(this.isPlaying)try{const e=new DataView(t),i=e.getUint32(0,!0),n=e.getFloat64(4,!0),a=e.getUint16(12,!0);if((e.getUint16(14,!0)&2)!==0){if(this.useOpus&&this.decoder&&this.decoder.state==="configured"){const c=new Uint8Array(t,N),u=Math.round(n*1e3),d=new EncodedAudioChunk({type:"key",timestamp:u,duration:2e4,data:c});this.seqMap.set(u,i),this.decoder.decode(d)}}else{if((t.byteLength-N)%2!==0)throw new Error("Malformed PCM packet: Odd byte length");const c=new Int16Array(t,N),u=pt(c);this.jitterBuffer.add({seq:i,targetPlayTime:n,channelMask:a,pcmData:u})}}catch(e){console.error("[AudioPlayer] Failed to process incoming chunk:",e)}}handleDecodedData(t){const e=t.timestamp,i=e/1e3;if(!this.seqMap.has(e)){console.warn(`[AudioPlayer] Decoder seqMap MISS for timestamp ${e}. Dropping chunk.`),t.close();return}const n=this.seqMap.get(e);this.seqMap.delete(e);const a=t.numberOfFrames,o=new Float32Array(a*2);try{if(t.format==="f32-planar"){const l=new Float32Array(a),c=new Float32Array(a);t.copyTo(l,{planeIndex:0}),t.copyTo(c,{planeIndex:1});for(let u=0;u<a;u++)o[u*2]=l[u],o[u*2+1]=c[u]}else if(t.format==="f32")t.copyTo(o,{planeIndex:0});else{console.warn(`[AudioPlayer] Unsupported decoder format: ${t.format}. Attempting planar fallback.`);const l=new Float32Array(a);t.copyTo(l,{planeIndex:0}),o.set(l)}this.jitterBuffer.add({seq:n,targetPlayTime:i,channelMask:3,pcmData:o})}catch(l){console.error("[AudioPlayer] Failed to extract audio from AudioData:",l)}finally{t.close()}}scheduleBuffers(){if(!this.isPlaying||!this.audioContext)return;const t=this.audioContext.currentTime,e=C.getSharedTime();let i=0;const n=5;for(;i<n;){const a=this.jitterBuffer.peek();if(!a)break;const o=a.targetPlayTime-e;if(o>200)break;if(this.jitterBuffer.pop(),o<-250)continue;let l=t+(o-this.spatialDelayMs+this.calibrationOffsetMs)/1e3-this.outputLatency+this.localDelayOffset;if(this.isFirstChunk){if(l<t){const m=t+.05-l;this.localDelayOffset+=m,l+=m}this.nextScheduledTime=l,this.isFirstChunk=!1,console.log(`[AudioPlayer] First chunk scheduled. Sync delay: ${o.toFixed(0)}ms`)}let c=l-this.nextScheduledTime;Math.abs(c)>.1&&(console.warn(`[AudioPlayer] Sync catastrophe: drift is ${(c*1e3).toFixed(1)}ms. Snapping.`),this.nextScheduledTime=l,this.driftIntegral=0,c=0),this.driftIntegral+=c,this.driftIntegral=Math.max(-K,Math.min(K,this.driftIntegral));let u=1;if(Math.abs(c)>5e-4){u=1-(c*bt+this.driftIntegral*xt);const w=At;u=Math.max(1-w,Math.min(1+w,u))}else this.driftIntegral*=.99;const d=this.audioContext.createBuffer(G,H,P),h=d.getChannelData(0),r=d.getChannelData(1);for(let m=0;m<H;m++){let w=a.pcmData[m*2]||0,k=a.pcmData[m*2+1]||0;if(this.surroundMask==="left")k=0;else if(this.surroundMask==="right")w=0;else if(this.surroundMask==="center"){const A=(w+k)*.707;w=A,k=A}else if(this.surroundMask==="lfe"){const A=(w+k)*.707;w=A,k=A}h[m]=w,r[m]=k}const p=this.audioContext.createBufferSource();p.buffer=d,p.playbackRate.value=u,p.connect(this.analyserNode),p.onended=()=>{p.disconnect()};const y=Math.max(this.nextScheduledTime,t);p.start(y);const b=H/P;this.nextScheduledTime=y+b/u;const f=t+o/1e3;this.syncDrift=(y-f)*1e3,this.chunksPlayed++,this.lastScheduledSeq=a.seq,i++}this.chunksPlayed%50===0&&this.chunksPlayed>0&&this.emit("stats_update",{chunksPlayed:this.chunksPlayed,bufferDepth:this.jitterBuffer.size(),syncDrift:this.syncDrift,outputLatency:this.outputLatency*1e3})}async playTestTone(){await this.init(),this.audioContext.state==="suspended"&&await this.audioContext.resume();const t=this.audioContext.createOscillator(),e=this.audioContext.createGain();t.type="sine",t.frequency.setValueAtTime(440,this.audioContext.currentTime),e.gain.setValueAtTime(0,this.audioContext.currentTime),e.gain.linearRampToValueAtTime(.2,this.audioContext.currentTime+.1),e.gain.linearRampToValueAtTime(0,this.audioContext.currentTime+.5),t.connect(e),e.connect(this.audioContext.destination),t.start(),t.stop(this.audioContext.currentTime+.6)}initBackgroundAudio(){if(this.backgroundAudio){this.backgroundAudio.play().catch(t=>console.warn("Background audio blocked:",t));return}this.backgroundAudio=new Audio,this.backgroundAudio.src="data:audio/wav;base64,UklGRqAQAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YUAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA",this.backgroundAudio.loop=!0,this.backgroundAudio.volume=.01,document.addEventListener("visibilitychange",()=>{document.visibilityState==="visible"&&this.isPlaying&&(this.audioContext.state==="suspended"&&this.audioContext.resume(),this.backgroundAudio.paused&&this.backgroundAudio.play().catch(()=>{}))}),this.backgroundAudio.play().catch(t=>console.warn("Background audio blocked:",t)),setInterval(()=>{this.isPlaying&&this.backgroundAudio.paused&&this.backgroundAudio.play().catch(()=>{})},3e3)}setupMediaSession(){if(!navigator.mediaSession)return;navigator.mediaSession.metadata=new MediaMetadata({title:"SoundMesh Live",artist:"Distributed Mesh Audio",album:"AuraSync v2.4 (High Stability)",artwork:[{src:"/public/logo-192.png",sizes:"192x192",type:"image/png"}]}),navigator.mediaSession.playbackState="playing";const t=["play","pause","stop"];for(const e of t)try{navigator.mediaSession.setActionHandler(e,()=>{e==="play"?this.start():(e==="pause"||e==="stop")&&this.stop()})}catch{}}setVolume(t){this.volume=Math.max(0,Math.min(1,t)),this.gainNode&&this.gainNode.gain.setTargetAtTime(this.muted?0:this.volume,this.audioContext.currentTime,.02),this.emit("volume_changed",this.volume)}toggleMute(){this.muted=!this.muted,this.gainNode&&this.gainNode.gain.setTargetAtTime(this.muted?0:this.volume,this.audioContext.currentTime,.02),this.emit("mute_changed",this.muted)}getAnalyser(){return this.analyserNode}getStats(){return{isPlaying:this.isPlaying,chunksPlayed:this.chunksPlayed,syncDrift:this.syncDrift,outputLatency:this.outputLatency*1e3,bufferDepth:this.jitterBuffer.size(),bufferStats:this.jitterBuffer.getStats(),volume:this.volume,muted:this.muted}}}const S=new Nt;class _t extends L{constructor(){super(),this.isCalibrating=!1,this.micStream=null,this.audioContext=null,this.processorNode=null,this.pulseIntervalMs=1e3,this.pulseCount=5,this.pulseFrequency=1e3,this.pulseDuration=.05,this.detectedOffsets=[]}async startHostCalibration(t=null){this.isCalibrating||(this.isCalibrating=!0,x.send("start_acoustic_cal",{targetDeviceId:t,pulseInterval:this.pulseIntervalMs,pulseCount:this.pulseCount,startTime:C.getSharedTime()+1e3}),console.log("[AuraSync] Host calibration started"),this.emit("host_cal_started"))}async handleCalRequest(t){const{startTime:e,pulseInterval:i,pulseCount:n}=t;try{await this.startDetection(e,i,n)}catch(a){console.error("[AuraSync] Detection failed:",a),this.emit("error",a.message)}}async startDetection(t,e,i){if(!this.isCalibrating){this.isCalibrating=!0,this.detectedOffsets=[];try{if(this.audioContext=S.audioContext,!this.audioContext)throw new Error("Audio engine not initialized. Please connect to host first.");this.micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!1,noiseSuppression:!1,autoGainControl:!1}});const n=this.audioContext.createMediaStreamSource(this.micStream);this.processorNode=this.audioContext.createScriptProcessor(2048,1,1);const a=.15;let o=0;this.processorNode.onaudioprocess=l=>{if(!this.isCalibrating)return;const c=l.inputBuffer.getChannelData(0),u=performance.now();for(let d=0;d<c.length;d++)if(Math.abs(c[d])>a&&u-o>e*.8){const r=C.getSharedTime(),p=r-t,y=Math.round(p/e);if(y>=0&&y<i){const b=t+y*e,m=r-b-10;this.detectedOffsets.push(m),o=u;const w=Math.round(this.detectedOffsets.length/i*100);this.emit("progress",{index:y,total:i,percent:w,offset:m})}}(this.detectedOffsets.length>=i||C.getSharedTime()>t+i*e+2e3)&&this.finishDetection()},n.connect(this.processorNode),console.log("[AuraSync] Node listening for pulses using shared context..."),this.emit("detection_started")}catch(n){this.isCalibrating=!1,this.emit("calibration_failed",n.message),this.stopAll()}}}finishDetection(){if(this.isCalibrating){if(this.detectedOffsets.length>0){const t=[...this.detectedOffsets].sort((i,n)=>i-n),e=t[Math.floor(t.length/2)];S.setCalibrationOffset(e),this.emit("calibration_complete",{offset:e})}else this.emit("calibration_failed","No pulses heard. Ensure volume is up and mic is enabled.");this.stopAll()}}stopAll(){this.isCalibrating=!1,this.micStream&&(this.micStream.getTracks().forEach(t=>t.stop()),this.micStream=null),this.processorNode&&(this.processorNode.disconnect(),this.processorNode=null),this.audioContext=null}async playPulses(t,e,i){const n=S.audioContext;if(n){for(let a=0;a<i;a++){const o=t+a*e,l=C.toLocalTime(o),c=n.createOscillator(),u=n.createGain();c.frequency.setValueAtTime(this.pulseFrequency,l/1e3),u.gain.setValueAtTime(0,l/1e3),u.gain.linearRampToValueAtTime(.5,(l+10)/1e3),u.gain.linearRampToValueAtTime(0,(l+50)/1e3),c.connect(u),u.connect(n.destination),c.start(l/1e3),c.stop((l+100)/1e3)}setTimeout(()=>{this.isCalibrating=!1,this.emit("host_cal_finished")},i*e+500)}}}const E=new _t;function Rt(){const s=document.getElementById("mesh-bg");if(!s)return;const t=s.getContext("2d");let e,i,n=[];const a=30,o=200,l=.3;function c(){e=s.width=window.innerWidth,i=s.height=window.innerHeight}function u(){n=[];for(let h=0;h<a;h++)n.push({x:Math.random()*e,y:Math.random()*i,vx:(Math.random()-.5)*l,vy:(Math.random()-.5)*l,radius:2+Math.random()*2,opacity:.3+Math.random()*.4})}function d(){t.clearRect(0,0,e,i);for(let h=0;h<n.length;h++){const r=n[h];r.x+=r.vx,r.y+=r.vy,(r.x<0||r.x>e)&&(r.vx*=-1),(r.y<0||r.y>i)&&(r.vy*=-1);for(let y=h+1;y<n.length;y++){const b=n[y],f=r.x-b.x,m=r.y-b.y,w=Math.sqrt(f*f+m*m);if(w<o){const k=(1-w/o)*.15;t.strokeStyle=`rgba(0, 229, 255, ${k})`,t.lineWidth=1,t.beginPath(),t.moveTo(r.x,r.y),t.lineTo(b.x,b.y),t.stroke()}}t.beginPath(),t.arc(r.x,r.y,r.radius,0,Math.PI*2),t.fillStyle=`rgba(0, 229, 255, ${r.opacity*.6})`,t.fill(),t.beginPath(),t.arc(r.x,r.y,r.radius*3,0,Math.PI*2);const p=t.createRadialGradient(r.x,r.y,0,r.x,r.y,r.radius*3);p.addColorStop(0,`rgba(0, 229, 255, ${r.opacity*.15})`),p.addColorStop(1,"rgba(0, 229, 255, 0)"),t.fillStyle=p,t.fill()}requestAnimationFrame(d)}c(),u(),d(),window.addEventListener("resize",()=>{c(),u()})}function at(s,t){return`
    <nav class="navbar" id="navbar">
      <div class="navbar-brand">
        <svg viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="12" stroke="url(#nav-g)" stroke-width="1.5" fill="none"/>
          <circle cx="14" cy="14" r="3" fill="#00e5ff"/>
          <circle cx="8" cy="8" r="1.5" fill="#00e5ff" opacity="0.7"/>
          <circle cx="20" cy="8" r="1.5" fill="#00e5ff" opacity="0.7"/>
          <circle cx="8" cy="20" r="1.5" fill="#00e5ff" opacity="0.7"/>
          <circle cx="20" cy="20" r="1.5" fill="#00e5ff" opacity="0.7"/>
          <line x1="14" y1="14" x2="8" y2="8" stroke="#00e5ff" stroke-width="0.5" opacity="0.4"/>
          <line x1="14" y1="14" x2="20" y2="8" stroke="#00e5ff" stroke-width="0.5" opacity="0.4"/>
          <line x1="14" y1="14" x2="8" y2="20" stroke="#00e5ff" stroke-width="0.5" opacity="0.4"/>
          <line x1="14" y1="14" x2="20" y2="20" stroke="#00e5ff" stroke-width="0.5" opacity="0.4"/>
          <defs><linearGradient id="nav-g" x1="0" y1="0" x2="28" y2="28">
            <stop stop-color="#00e5ff"/><stop offset="1" stop-color="#7c4dff"/>
          </linearGradient></defs>
        </svg>
        SoundMesh
      </div>
      <div class="navbar-actions">
        ${t?`
          <span class="badge badge-primary">${t.roomName||"Session"}</span>
          <span class="badge badge-success">
            <span class="status-dot status-dot--synced" style="width:6px;height:6px;"></span>
            ${s==="host"?"Host":"Node"}
          </span>
        `:""}
      </div>
    </nav>
  `}function ot(){const s=document.getElementById("app");s.innerHTML=`
    <div class="landing page page-enter">
      <!-- Hero Section -->
      <div class="landing-hero">
        <div class="landing-hero-content">
          <!-- Logo -->
          <div class="landing-logo float">
            <svg viewBox="0 0 80 80" fill="none" width="80" height="80">
              <circle cx="40" cy="40" r="36" stroke="url(#lg)" stroke-width="2" fill="none" opacity="0.3"/>
              <circle cx="40" cy="40" r="26" stroke="url(#lg)" stroke-width="1.5" fill="none" opacity="0.5"/>
              <circle cx="40" cy="40" r="16" stroke="url(#lg)" stroke-width="1.5" fill="none" opacity="0.7"/>
              <circle cx="40" cy="40" r="6" fill="#00e5ff"/>
              <!-- Mesh nodes -->
              <circle cx="22" cy="22" r="3" fill="#00e5ff" opacity="0.8"/>
              <circle cx="58" cy="22" r="3" fill="#7c4dff" opacity="0.8"/>
              <circle cx="22" cy="58" r="3" fill="#ff9100" opacity="0.8"/>
              <circle cx="58" cy="58" r="3" fill="#00e676" opacity="0.8"/>
              <!-- Connection lines -->
              <line x1="40" y1="40" x2="22" y2="22" stroke="#00e5ff" stroke-width="1" opacity="0.3"/>
              <line x1="40" y1="40" x2="58" y2="22" stroke="#7c4dff" stroke-width="1" opacity="0.3"/>
              <line x1="40" y1="40" x2="22" y2="58" stroke="#ff9100" stroke-width="1" opacity="0.3"/>
              <line x1="40" y1="40" x2="58" y2="58" stroke="#00e676" stroke-width="1" opacity="0.3"/>
              <defs>
                <linearGradient id="lg" x1="0" y1="0" x2="80" y2="80">
                  <stop stop-color="#00e5ff"/><stop offset="1" stop-color="#7c4dff"/>
                </linearGradient>
              </defs>
            </svg>
          </div>

          <h1 class="landing-title">
            Sound<span class="text-accent">Mesh</span>
          </h1>

          <p class="landing-subtitle">
            Turn every device into a synchronized speaker
          </p>

          <!-- Sound Wave Animation -->
          <div class="sound-wave" style="margin: 24px 0;">
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
          </div>

          <p class="landing-desc">
            Stream any audio from your computer — Spotify, YouTube, anything —
            to all devices on your Wi-Fi network in perfect sync.
            No apps to install on nodes, just open a browser.
          </p>

          <!-- Connection Status -->
          <div class="landing-status" id="landing-status">
            <div class="spinner"></div>
            <span>Connecting to SoundMesh server...</span>
          </div>
        </div>

        <!-- Features Grid -->
        <div class="landing-features stagger-list">
          <div class="feature-card glass-card hover-lift">
            <div class="feature-icon">🎵</div>
            <h4>Any Audio Source</h4>
            <p>Stream system audio from Spotify, YouTube, or any app playing on the host device.</p>
          </div>
          <div class="feature-card glass-card hover-lift">
            <div class="feature-icon">⚡</div>
            <h4>Sub-5ms Sync</h4>
            <p>NTP-style clock synchronization keeps all devices within 5 milliseconds — inaudible to humans.</p>
          </div>
          <div class="feature-card glass-card hover-lift">
            <div class="feature-icon">📱</div>
            <h4>Zero Install for Nodes</h4>
            <p>Other devices just open a URL in their browser. Works on phones, tablets, and laptops.</p>
          </div>
          <div class="feature-card glass-card hover-lift">
            <div class="feature-icon">🔊</div>
            <h4>Surround Sound</h4>
            <p>Place devices around the room for stereo, 5.1, or 7.1 surround sound from any stereo source.</p>
          </div>
        </div>
      </div>
    </div>

    <style>
      .landing {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--space-xl);
      }

      .landing-hero {
        max-width: 800px;
        width: 100%;
        text-align: center;
      }

      .landing-hero-content {
        margin-bottom: var(--space-3xl);
      }

      .landing-logo {
        display: inline-block;
        margin-bottom: var(--space-lg);
        filter: drop-shadow(0 0 20px rgba(0, 229, 255, 0.3));
      }

      .landing-title {
        font-size: var(--font-size-hero);
        font-weight: 800;
        letter-spacing: -2px;
        margin-bottom: var(--space-sm);
        background: linear-gradient(135deg, var(--text-primary) 0%, var(--accent-primary) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .landing-subtitle {
        font-size: var(--font-size-xl);
        color: var(--text-secondary);
        font-weight: 300;
        margin-bottom: var(--space-md);
      }

      .landing-desc {
        font-size: var(--font-size-md);
        color: var(--text-tertiary);
        max-width: 500px;
        margin: 0 auto var(--space-xl);
        line-height: 1.8;
      }

      .landing-status {
        display: inline-flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-md) var(--space-xl);
        background: var(--bg-glass);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-full);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }

      .landing-features {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--space-md);
      }

      .feature-card {
        text-align: left;
        padding: var(--space-lg);
      }

      .feature-icon {
        font-size: 2rem;
        margin-bottom: var(--space-sm);
      }

      .feature-card h4 {
        font-size: var(--font-size-md);
        margin-bottom: var(--space-xs);
      }

      .feature-card p {
        font-size: var(--font-size-sm);
        color: var(--text-tertiary);
        line-height: 1.6;
      }

      @media (max-width: 640px) {
        .landing-title { font-size: var(--font-size-4xl); }
        .landing-features { grid-template-columns: 1fr; }
        .landing { padding: var(--space-md); }
      }
    </style>
  `}function rt(s,t){if(!s||!t)return()=>{};const e=s.getContext("2d");let i,n=!0;function a(){const d=s.parentElement.getBoundingClientRect();s.width=d.width*window.devicePixelRatio,s.height=d.height*window.devicePixelRatio,e.scale(window.devicePixelRatio,window.devicePixelRatio)}a();const o=t.frequencyBinCount,l=new Uint8Array(o);function c(){if(!n)return;i=requestAnimationFrame(c),t.getByteTimeDomainData(l);const d=s.width/window.devicePixelRatio,h=s.height/window.devicePixelRatio;e.clearRect(0,0,d,h),e.strokeStyle="rgba(255, 255, 255, 0.03)",e.lineWidth=1;const r=8;for(let b=1;b<r;b++){const f=h/r*b;e.beginPath(),e.moveTo(0,f),e.lineTo(d,f),e.stroke()}e.strokeStyle="rgba(0, 229, 255, 0.1)",e.beginPath(),e.moveTo(0,h/2),e.lineTo(d,h/2),e.stroke();const p=d/o;let y=0;e.shadowColor="#00e5ff",e.shadowBlur=8,e.lineWidth=2,e.strokeStyle="#00e5ff",e.beginPath();for(let b=0;b<o;b++){const m=l[b]/128*h/2;b===0?e.moveTo(y,m):e.lineTo(y,m),y+=p}e.stroke(),e.shadowBlur=0,e.lineWidth=1,e.strokeStyle="rgba(0, 229, 255, 0.3)",e.beginPath(),y=0;for(let b=0;b<o;b++){const m=l[b]/128*h/2+1;b===0?e.moveTo(y,m):e.lineTo(y,m),y+=p}e.stroke(),e.shadowBlur=0}c();const u=new ResizeObserver(a);return u.observe(s.parentElement),()=>{n=!1,i&&cancelAnimationFrame(i),u.disconnect()}}const Dt="modulepreload",Ot=function(s){return"/"+s},Z={},Ft=function(t,e,i){let n=Promise.resolve();if(e&&e.length>0){document.getElementsByTagName("link");const o=document.querySelector("meta[property=csp-nonce]"),l=(o==null?void 0:o.nonce)||(o==null?void 0:o.getAttribute("nonce"));n=Promise.allSettled(e.map(c=>{if(c=Ot(c),c in Z)return;Z[c]=!0;const u=c.endsWith(".css"),d=u?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${c}"]${d}`))return;const h=document.createElement("link");if(h.rel=u?"stylesheet":Dt,u||(h.as="script"),h.crossOrigin="",h.href=c,l&&h.setAttribute("nonce",l),document.head.appendChild(h),u)return new Promise((r,p)=>{h.addEventListener("load",r),h.addEventListener("error",()=>p(new Error(`Unable to preload CSS for ${c}`)))})}))}function a(o){const l=new Event("vite:preloadError",{cancelable:!0});if(l.payload=o,window.dispatchEvent(l),!l.defaultPrevented)throw o}return n.then(o=>{for(const l of o||[])l.status==="rejected"&&a(l.reason);return t().catch(a)})};let _="2.0",M={};function B(){const s=document.getElementById("app"),t=g.devices;s.innerHTML=`
    <div class="placement-page page page-enter">
      <!-- Back button -->
      <div class="placement-header">
        <button class="btn btn-ghost" id="btn-back-dashboard">← Back to Dashboard</button>
        <h3>🗺️ Surround Sound Placement</h3>
        <div class="layout-switcher">
          <button class="btn btn-sm ${_==="2.0"?"btn-primary":"btn-secondary"}" data-layout="2.0">Stereo</button>
          <button class="btn btn-sm ${_==="5.1"?"btn-primary":"btn-secondary"}" data-layout="5.1">5.1</button>
          <button class="btn btn-sm ${_==="7.1"?"btn-primary":"btn-secondary"}" data-layout="7.1">7.1</button>
        </div>
      </div>

      <div class="placement-body">
        <!-- Room Grid -->
        <div class="room-grid glass-card" id="room-grid">
          <div class="room-label">SCREEN / FRONT</div>

          ${$t()}

          <!-- Center listener icon -->
          <div class="listener-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="12" r="5" fill="rgba(255,255,255,0.3)"/>
              <path d="M8 28c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="rgba(255,255,255,0.15)"/>
            </svg>
            <span class="text-xs text-secondary">Listener</span>
          </div>

          <div class="room-label room-label--bottom">REAR</div>
        </div>

        <!-- Unassigned Devices -->
        <div class="unassigned-panel glass-card">
          <h4 style="margin-bottom: var(--space-md);">📱 Available Devices</h4>
          <div id="unassigned-devices" class="unassigned-list">
            ${zt(t)}
          </div>
          <p class="text-xs text-secondary" style="margin-top: var(--space-md);">
            Drag devices to position slots, or click a slot then a device to assign.
          </p>
        </div>
      </div>
    </div>

    <style>
      .placement-page {
        min-height: 100vh;
        padding: var(--space-lg);
      }

      .placement-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-xl);
        flex-wrap: wrap;
        gap: var(--space-md);
      }

      .layout-switcher {
        display: flex;
        gap: var(--space-xs);
      }

      .placement-body {
        display: grid;
        grid-template-columns: 1fr 300px;
        gap: var(--space-lg);
        max-width: 1100px;
        margin: 0 auto;
      }

      .room-grid {
        position: relative;
        aspect-ratio: 4/3;
        min-height: 400px;
        background:
          linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px),
          var(--bg-glass);
        background-size: 40px 40px, 40px 40px;
        border: 1px solid var(--border-accent);
        overflow: hidden;
      }

      .room-label {
        position: absolute;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
        text-transform: uppercase;
        letter-spacing: 2px;
      }

      .room-label--bottom {
        top: auto;
        bottom: 8px;
      }

      .listener-icon {
        position: absolute;
        top: 55%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        opacity: 0.5;
      }

      /* Position Slots */
      .position-slot {
        position: absolute;
        width: 90px;
        min-height: 70px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--space-sm);
        border: 2px dashed var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-glass);
        cursor: pointer;
        transition: all var(--transition-normal);
        text-align: center;
        transform: translate(-50%, -50%);
      }

      .position-slot:hover {
        border-color: var(--accent-primary);
        background: var(--accent-primary-dim);
      }

      .position-slot.occupied {
        border-style: solid;
        border-color: var(--accent-primary);
        background: rgba(0, 229, 255, 0.08);
      }

      .position-slot.active-layout {
        display: flex;
      }

      .position-slot.inactive-layout {
        display: none;
      }

      .position-slot-label {
        font-size: var(--font-size-xs);
        font-weight: 700;
        color: var(--accent-primary);
        letter-spacing: 0.5px;
      }

      .position-slot-device {
        font-size: 10px;
        color: var(--text-secondary);
        margin-top: 2px;
        max-width: 80px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .position-slot-icon {
        font-size: 1.2rem;
        margin-bottom: 2px;
      }

      /* Unassigned Panel */
      .unassigned-panel {
        height: fit-content;
        position: sticky;
        top: 80px;
      }

      .unassigned-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }

      .unassigned-device {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        background: var(--bg-glass);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
        cursor: grab;
        transition: all var(--transition-fast);
        font-size: var(--font-size-sm);
      }

      .unassigned-device:hover {
        border-color: var(--accent-primary);
        transform: translateX(4px);
      }

      .unassigned-device.dragging {
        opacity: 0.5;
        cursor: grabbing;
      }

      .unassigned-device .device-icon {
        font-size: 1.2rem;
      }

      @media (max-width: 768px) {
        .placement-body {
          grid-template-columns: 1fr;
        }
      }
    </style>
  `,qt()}function $t(){const s=Et[_]||[];return Object.entries(z).map(([t,e])=>{const i=s.includes(t),n=M[t],a=n?g.devices.find(o=>o.deviceId===n):null;return`
      <div class="position-slot ${a?"occupied":""} ${i?"active-layout":"inactive-layout"}"
           data-position="${t}"
           style="left: ${e.x}%; top: ${e.y}%;"
           id="slot-${t}">
        ${a?`
          <div class="position-slot-icon">${Y(a.platform)}</div>
          <div class="position-slot-label">${t}</div>
          <div class="position-slot-device">${a.name}</div>
        `:`
          <div class="position-slot-label">${t}</div>
          <div class="position-slot-device">${e.label}</div>
        `}
      </div>
    `}).join("")}function zt(s){const t=new Set(Object.values(M)),e=s.filter(i=>!t.has(i.deviceId));return e.length===0?'<p class="text-sm text-secondary" style="text-align: center; padding: 16px;">All devices assigned</p>':e.map(i=>`
    <div class="unassigned-device" data-device-id="${i.deviceId}" draggable="true">
      <span class="device-icon">${Y(i.platform)}</span>
      <span>${i.name}</span>
    </div>
  `).join("")}let R=null;function qt(){var s;(s=document.getElementById("btn-back-dashboard"))==null||s.addEventListener("click",async()=>{const{renderHostDashboard:t}=await Ft(async()=>{const{renderHostDashboard:e}=await Promise.resolve().then(()=>Gt);return{renderHostDashboard:e}},void 0);t()}),document.querySelectorAll("[data-layout]").forEach(t=>{t.addEventListener("click",()=>{_=t.dataset.layout,B()})}),document.querySelectorAll(".unassigned-device").forEach(t=>{t.addEventListener("click",()=>{R=t.dataset.deviceId,document.querySelectorAll(".unassigned-device").forEach(e=>e.style.borderColor=""),t.style.borderColor="var(--accent-primary)",v("Now click a position slot to place this device","info")})}),document.querySelectorAll(".position-slot").forEach(t=>{t.addEventListener("click",()=>{const e=t.dataset.position;R?(Q(R,e),R=null,B()):M[e]&&(Ht(e),B())})}),document.querySelectorAll(".unassigned-device").forEach(t=>{t.addEventListener("dragstart",e=>{e.dataTransfer.setData("text/plain",t.dataset.deviceId),t.classList.add("dragging")}),t.addEventListener("dragend",()=>{t.classList.remove("dragging")})}),document.querySelectorAll(".position-slot").forEach(t=>{t.addEventListener("dragover",e=>{e.preventDefault(),t.style.borderColor="var(--accent-primary)",t.style.background="rgba(0, 229, 255, 0.15)"}),t.addEventListener("dragleave",()=>{t.style.borderColor="",t.style.background=""}),t.addEventListener("drop",e=>{e.preventDefault();const i=e.dataTransfer.getData("text/plain"),n=t.dataset.position;Q(i,n),B()})})}function Q(s,t){var e;for(const[i,n]of Object.entries(M))n===s&&delete M[i];M[t]=s,x.send("placement_update",{deviceId:s,position:t}),v(`Device assigned to ${((e=z[t])==null?void 0:e.label)||t}`,"success")}function Ht(s){const t=M[s];delete M[s],t&&(x.send("placement_update",{deviceId:t,position:"unassigned"}),v("Device removed from position","info"))}const U=150,tt=5;function Ut(s){if(!s)return;const t=s.getContext("2d"),e=[];let i;function n(){const c=s.parentElement.getBoundingClientRect();s.width=c.width*window.devicePixelRatio,s.height=150*window.devicePixelRatio,t.scale(window.devicePixelRatio,window.devicePixelRatio)}n();const a=setInterval(()=>{const c=C.getStats();c.sampleCount>0&&(e.push({time:Date.now(),offset:c.avgOffset,variance:c.offsetVariance,rtt:c.avgRtt}),e.length>U&&e.shift())},200);function o(){i=requestAnimationFrame(o);const c=s.width/window.devicePixelRatio,u=s.height/window.devicePixelRatio,d={top:10,right:10,bottom:20,left:40},h=c-d.left-d.right,r=u-d.top-d.bottom;t.clearRect(0,0,c,u),t.fillStyle="rgba(6, 10, 20, 0.5)",t.fillRect(0,0,c,u);const p=20,y=d.top+r*(1-(p+tt)/(p*2)),b=d.top+r*(1-(p-tt)/(p*2));t.fillStyle="rgba(0, 230, 118, 0.05)",t.fillRect(d.left,y,h,b-y),t.strokeStyle="rgba(0, 230, 118, 0.2)",t.setLineDash([4,4]),t.lineWidth=1,t.beginPath(),t.moveTo(d.left,y),t.lineTo(d.left+h,y),t.moveTo(d.left,b),t.lineTo(d.left+h,b),t.stroke(),t.setLineDash([]);const f=d.top+r/2;if(t.strokeStyle="rgba(255, 255, 255, 0.1)",t.beginPath(),t.moveTo(d.left,f),t.lineTo(d.left+h,f),t.stroke(),t.fillStyle="rgba(255, 255, 255, 0.3)",t.font="10px Inter, sans-serif",t.textAlign="right",t.fillText(`+${p}ms`,d.left-4,d.top+10),t.fillText("0ms",d.left-4,f+4),t.fillText(`-${p}ms`,d.left-4,u-d.bottom),t.fillStyle="rgba(0, 230, 118, 0.4)",t.fillText("+5",d.left-4,y+4),t.fillText("-5",d.left-4,b+4),e.length<2){t.fillStyle="rgba(255, 255, 255, 0.2)",t.textAlign="center",t.font="12px Inter, sans-serif",t.fillText("Collecting sync data...",c/2,u/2);return}t.beginPath(),t.strokeStyle="#00e5ff",t.lineWidth=2,t.shadowColor="#00e5ff",t.shadowBlur=6;for(let m=0;m<e.length;m++){const w=d.left+m/U*h,k=Math.max(-p,Math.min(p,e[m].offset)),A=d.top+r*(1-(k+p)/(p*2));m===0?t.moveTo(w,A):t.lineTo(w,A)}if(t.stroke(),t.shadowBlur=0,e.length>0){const m=e[e.length-1],w=d.left+(e.length-1)/U*h,k=Math.max(-p,Math.min(p,m.offset)),A=d.top+r*(1-(k+p)/(p*2));t.beginPath(),t.arc(w,A,4,0,Math.PI*2),t.fillStyle="#00e5ff",t.fill(),t.beginPath(),t.arc(w,A,8,0,Math.PI*2),t.fillStyle="rgba(0, 229, 255, 0.2)",t.fill()}}o();const l=new ResizeObserver(n);return l.observe(s.parentElement),()=>{cancelAnimationFrame(i),clearInterval(a),l.disconnect()}}let F=null,W=null;function ct(){var t;const s=document.getElementById("app");s.innerHTML=`
    ${at("host",g.session)}

    <div class="container page page-enter">
      <div class="page-header">
        <h2>🎛️ Host Dashboard</h2>
        <p class="text-secondary" style="margin-top: 4px;">
          Capture and stream audio to all connected devices
        </p>
      </div>

      <div class="page-content">
        <!-- Audio Source Section -->
        <div class="dashboard-grid">
          <!-- Left Column -->
          <div class="dashboard-main">
            <!-- Audio Capture Card -->
            <div class="glass-card glow-breathe" id="capture-card">
              <div class="section-header">
                <h3 class="section-title">🎵 Audio Source</h3>
                <div id="capture-status" class="badge badge-warning">Not Active</div>
              </div>

              <!-- Source Selection -->
              <div class="source-buttons" id="source-buttons">
                <button class="btn btn-primary btn-lg" id="btn-system-audio" style="width: 100%;">
                  🖥️ Capture System Audio
                </button>
                <div class="source-alt-row">
                  <button class="btn btn-secondary" id="btn-file-upload">
                    📁 Upload File
                  </button>
                  <button class="btn btn-secondary" id="btn-mic">
                    🎤 Microphone
                  </button>
                </div>
                <input type="file" id="file-input" accept="audio/*" style="display: none;">
                <p class="text-xs text-secondary" style="margin-top: 8px; text-align: center;">
                  System Audio captures everything playing — Spotify, YouTube, games, anything
                </p>
              </div>

              <!-- Active Capture Controls (hidden initially) -->
              <div id="active-capture" class="hidden">
                <div class="waveform-container" id="waveform-host">
                  <canvas id="waveform-canvas"></canvas>
                </div>
                <div class="capture-controls">
                  <div class="capture-info">
                    <span class="badge badge-success" id="capture-source-badge">System Audio</span>
                    <span class="text-sm text-secondary" id="capture-stats">Streaming...</span>
                  </div>
                  <button class="btn btn-danger btn-sm" id="btn-stop-capture">
                    ⏹ Stop
                  </button>
                  <button class="btn btn-outline btn-sm" id="btn-host-loopback">
                    🎧 Monitor Sync
                  </button>
                </div>
              </div>
            </div>

            <!-- Sync Monitor -->
            <div class="glass-card" id="sync-card">
              <div class="section-header">
                <h3 class="section-title">📊 Sync Monitor</h3>
                <span class="text-sm text-secondary" id="sync-stats">Waiting...</span>
              </div>
              <div id="sync-monitor-container">
                <canvas id="sync-canvas" width="600" height="150"></canvas>
              </div>
            </div>
          </div>

          <!-- Right Column -->
          <div class="dashboard-sidebar">
            <!-- Session Info -->
            <div class="glass-card glass-card--accent">
              <div class="section-header">
                <h3 class="section-title">🌐 Session</h3>
              </div>
              <div class="session-info">
                <div class="session-room-name">${((t=g.session)==null?void 0:t.roomName)||"Loading..."}</div>
                <div class="session-url" id="session-url">
                  <span class="text-xs text-secondary">Share this URL with other devices:</span>
                  <div class="url-copy-row">
                    <code id="node-url">Loading...</code>
                    <button class="btn btn-ghost btn-icon btn-sm" id="btn-copy-url" title="Copy URL">
                      📋
                    </button>
                  </div>
                </div>
                <div class="session-stats">
                  <div class="stat-item">
                    <span class="stat-value" id="device-count">${g.devices.length}</span>
                    <span class="stat-label">Devices</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-value" id="sync-accuracy">--</span>
                    <span class="stat-label">Sync (ms)</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-value" id="data-rate">--</span>
                    <span class="stat-label">Kbps</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Connected Devices -->
            <div class="glass-card">
              <div class="section-header">
                <h3 class="section-title">📱 Devices</h3>
                <span class="badge badge-primary" id="device-count-badge">${g.devices.length}</span>
              </div>
              <div id="device-list" class="device-list stagger-list">
                ${et()}
              </div>
            </div>

            <!-- Actions -->
            <div style="display: flex; gap: 8px; margin-top: 8px;">
              <button class="btn btn-secondary" id="btn-test-nodes" style="flex: 1;">
                🔔 Test
              </button>
              <button class="btn btn-primary" id="btn-auto-cal" style="flex: 1;">
                ✨ Auto-Sync
              </button>
              <button class="btn btn-secondary" id="btn-placement" style="flex: 1;">
                🗺️ Grid
              </button>
            </div>
          </div>
        </div>
      </div>

    <!-- Calibration Info Modal (Host) -->
    <div class="modal-overlay hidden" id="modal-cal-host">
      <div class="modal glass-card">
        <div class="modal-icon">✨</div>
        <h2 class="modal-title">Mesh Sync Complete!</h2>
        <p class="modal-body" id="modal-cal-body">
          Calibration beeps finished. All connected devices should now be in phase-alignment.
        </p>
        <div class="modal-actions">
          <button class="btn btn-primary w-full" id="btn-modal-cal-close">Done</button>
        </div>
      </div>
    </div>
    </div>

    <style>
      .dashboard-grid {
        display: grid;
        grid-template-columns: 1fr 360px;
        gap: var(--space-lg);
        align-items: start;
      }

      .dashboard-main {
        display: flex;
        flex-direction: column;
        gap: var(--space-lg);
      }

      .dashboard-sidebar {
        display: flex;
        flex-direction: column;
        gap: var(--space-lg);
      }

      .source-buttons {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }

      .source-alt-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-sm);
      }

      .capture-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: var(--space-md);
      }

      .capture-info {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .session-info {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }

      .session-room-name {
        font-size: var(--font-size-2xl);
        font-weight: 800;
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-purple));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .url-copy-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        margin-top: var(--space-xs);
        padding: var(--space-sm) var(--space-md);
        background: var(--bg-deep);
        border-radius: var(--radius-sm);
        border: 1px solid var(--border-subtle);
      }

      .url-copy-row code {
        flex: 1;
        font-size: var(--font-size-sm);
        color: var(--accent-primary);
        word-break: break-all;
      }

      .session-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--space-sm);
        text-align: center;
      }

      .stat-item {
        padding: var(--space-sm);
        background: var(--bg-glass);
        border-radius: var(--radius-sm);
      }

      .stat-value {
        display: block;
        font-size: var(--font-size-xl);
        font-weight: 700;
        color: var(--accent-primary);
      }

      .stat-label {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .device-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        max-height: 400px;
        overflow-y: auto;
      }

      .device-volume {
        width: 80px;
      }

      #sync-monitor-container {
        border-radius: var(--radius-md);
        overflow: hidden;
        background: var(--bg-deep);
        border: 1px solid var(--border-subtle);
      }

      #sync-canvas {
        width: 100%;
        height: 150px;
        display: block;
      }

      @media (max-width: 900px) {
        .dashboard-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  `,Wt(),jt(),Ut(document.getElementById("sync-canvas")),document.addEventListener("devices-updated",e=>{const i=document.getElementById("device-list"),n=document.getElementById("device-count-badge"),a=document.getElementById("device-count");i&&(i.innerHTML=et()),n&&(n.textContent=g.devices.length),a&&(a.textContent=g.devices.length)}),W&&clearInterval(W),W=setInterval(Vt,1e3)}function et(){return g.devices.length===0?`
      <div class="empty-state">
        <div class="empty-state-icon">📱</div>
        <p class="empty-state-text">No devices connected yet.<br>Share the URL above!</p>
      </div>
    `:g.devices.map(s=>{const t=Y(s.platform),e=s.role==="host",i=s.syncStatus==="in_sync"?"synced":s.syncStatus==="drifting"?"drifting":"offline";return`
      <div class="device-card" data-device-id="${s.deviceId}">
        <div class="device-card-icon">${t}</div>
        <div class="device-card-info">
          <div class="device-card-name">
            ${s.name} ${e?'<span class="badge badge-primary" style="font-size:10px;">HOST</span>':""}
          </div>
          <div class="device-card-meta">
            <span class="status-dot status-dot--${i}"></span>
            <span>${s.platform||"Unknown"}</span>
            ${s.position?`<span>• ${s.position}</span>`:""}
          </div>
        </div>
        ${e?"":`
          <div class="device-card-actions">
            <input type="range" class="range-slider device-volume"
              min="0" max="100" value="${Math.round((s.volume||1)*100)}"
              data-device-id="${s.deviceId}"
              title="Volume: ${Math.round((s.volume||1)*100)}%">
          </div>
        `}
      </div>
    `}).join("")}function Wt(){var t,e,i,n,a,o,l,c,u,d,h;(t=document.getElementById("btn-system-audio"))==null||t.addEventListener("click",async()=>{try{if(!window.isSecureContext){v("System Audio requires a Secure Context (HTTPS or localhost). Please upload a file instead.","warning");return}if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){v("System Audio capture is not supported on this browser (Mobile devices do not support this feature).","error");return}await I.startSystemCapture(),T.start(),j("System Audio"),v("System audio capture started!","success"),x.send("playback_state",{isPlaying:!0,source:"system"})}catch{v('Failed to capture audio. Make sure to check "Share audio" when sharing your screen.',"error")}}),(e=document.getElementById("btn-file-upload"))==null||e.addEventListener("click",()=>{var r;(r=document.getElementById("file-input"))==null||r.click()}),(i=document.getElementById("file-input"))==null||i.addEventListener("change",async r=>{const p=r.target.files[0];if(p)try{await I.startFilePlayback(p),T.start(),j(`File: ${p.name}`),v(`Playing: ${p.name}`,"success"),x.send("playback_state",{isPlaying:!0,source:"file"})}catch(y){v("Failed to play file: "+y.message,"error")}}),(n=document.getElementById("btn-mic"))==null||n.addEventListener("click",async()=>{try{if(!window.isSecureContext){v("Microphone access requires a Secure Context (HTTPS or localhost).","warning");return}if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){v("Microphone capture is not supported on this browser.","error");return}await I.startMicCapture(),T.start(),j("Microphone"),v("Microphone capture started!","success"),x.send("playback_state",{isPlaying:!0,source:"microphone"})}catch{v("Microphone access denied","error")}}),(a=document.getElementById("btn-stop-capture"))==null||a.addEventListener("click",()=>{I.stop(),T.stop(),st(),v("Audio capture stopped","info"),x.send("playback_state",{isPlaying:!1,source:null})}),I.on("capture_stopped",()=>{T.stop(),audioPlayer.stop(),st(),v("Audio capture ended","warning")}),(o=document.getElementById("btn-host-loopback"))==null||o.addEventListener("click",async()=>{try{audioPlayer.isPlaying?(audioPlayer.stop(),document.getElementById("btn-host-loopback").textContent="🎧 Monitor Sync",document.getElementById("btn-host-loopback").className="btn btn-outline btn-sm",v("Host monitoring disabled","info")):(await audioPlayer.start(),v("Host monitoring enabled (Mesh Sync)","success"),document.getElementById("btn-host-loopback").textContent="🔊 Monitoring ON",document.getElementById("btn-host-loopback").className="btn btn-primary btn-sm")}catch(r){v("Loopback failed: "+r.message,"error")}}),(l=document.getElementById("btn-copy-url"))==null||l.addEventListener("click",()=>{var p;const r=(p=document.getElementById("node-url"))==null?void 0:p.textContent;r&&r!=="Loading..."&&navigator.clipboard.writeText(r).then(()=>{v("URL copied to clipboard!","success")})}),(c=document.getElementById("btn-test-nodes"))==null||c.addEventListener("click",()=>{x.send("trigger_test_tone",{targetDeviceId:"all"}),v("Sent test tone command to nodes","info")}),(u=document.getElementById("btn-placement"))==null||u.addEventListener("click",()=>{B()});const s=document.getElementById("btn-auto-cal");s==null||s.addEventListener("click",()=>{if(!T.isStreaming){v("Start audio source first!","error");return}E.startHostCalibration(null)}),E.on("host_cal_started",()=>{s.textContent="🔊 Calibrating...",s.className="btn btn-warning pulsate",v("Sending calibration pulses to all nodes...","info")}),E.on("host_cal_finished",()=>{s.textContent="✨ Auto-Sync",s.className="btn btn-primary",v("Calibration complete.","success");const r=document.getElementById("modal-cal-host");r&&r.classList.remove("hidden")}),(d=document.getElementById("btn-modal-cal-close"))==null||d.addEventListener("click",()=>{var r;(r=document.getElementById("modal-cal-host"))==null||r.classList.add("hidden")}),(h=document.getElementById("device-list"))==null||h.addEventListener("input",r=>{if(r.target.classList.contains("device-volume")){const p=r.target.dataset.deviceId,y=parseInt(r.target.value)/100;x.send("volume_change",{targetDeviceId:p,volume:y})}})}function j(s){var e,i;(e=document.getElementById("source-buttons"))==null||e.classList.add("hidden"),(i=document.getElementById("active-capture"))==null||i.classList.remove("hidden"),document.getElementById("capture-status").textContent="Streaming",document.getElementById("capture-status").className="badge badge-success",document.getElementById("capture-source-badge").textContent=s;const t=document.getElementById("waveform-canvas");t&&(F=rt(t,I.getAnalyser()))}function st(){var s,t;(s=document.getElementById("source-buttons"))==null||s.classList.remove("hidden"),(t=document.getElementById("active-capture"))==null||t.classList.add("hidden"),document.getElementById("capture-status").textContent="Not Active",document.getElementById("capture-status").className="badge badge-warning",F&&(F(),F=null)}async function jt(){try{const t=await(await fetch("/api/connection-info")).json(),e=document.getElementById("node-url");e&&(e.textContent=t.url)}catch(s){console.error("Failed to fetch connection info:",s)}}function Vt(){const s=C.getStats(),t=document.getElementById("sync-accuracy");t&&s.avgRtt>0&&(t.textContent=s.offsetVariance.toFixed(1));const e=T.getStats(),i=document.getElementById("data-rate");if(i&&e.isStreaming){const o=(e.bytesSent*8/1e3/(e.chunksSent*.02||1)).toFixed(0);i.textContent=o}const n=document.getElementById("capture-stats");n&&e.isStreaming&&(n.textContent=`${e.chunksSent} chunks sent`);const a=document.getElementById("sync-stats");a&&s.avgRtt>0&&(a.textContent=`RTT: ${s.avgRtt.toFixed(1)}ms | Offset: ${s.avgOffset.toFixed(2)}ms`)}const Gt=Object.freeze(Object.defineProperty({__proto__:null,renderHostDashboard:ct},Symbol.toStringTag,{value:"Module"}));let D=null,V=null;function Yt(){var t;const s=document.getElementById("app");s.innerHTML=`
    ${at("node",g.session)}

    <div class="container page page-enter">
      <div class="page-header" style="text-align: center;">
        <h2>🔊 Node Mode</h2>
        <p class="text-secondary" style="margin-top: 4px;">
          Connected to <strong class="text-accent">${((t=g.session)==null?void 0:t.roomName)||"Host"}</strong>
        </p>
      </div>

      <div class="page-content">
        <div class="node-layout">
          <!-- Sync Status Ring -->
          <div class="sync-ring-container glass-card glass-card--accent" id="sync-ring-card">
            <div class="sync-ring" id="sync-ring">
              <div class="sync-ring-inner">
                <div class="sync-ring-value" id="sync-offset-display">--</div>
                <div class="sync-ring-label">ms offset</div>
              </div>
              <svg class="sync-ring-svg" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="4"/>
                <circle cx="60" cy="60" r="54" fill="none" stroke="#00e676" stroke-width="4"
                  stroke-dasharray="339" stroke-dashoffset="0" stroke-linecap="round"
                  id="sync-ring-progress"/>
              </svg>
            </div>
            <div class="sync-status-text" id="sync-status-text">
              <span class="status-dot status-dot--offline" id="sync-status-dot"></span>
              <span id="sync-status-label">Waiting for sync...</span>
            </div>
          </div>

          <!-- Connection Panel -->
          <div class="glass-card" style="margin-bottom: 24px;">
            <div class="section-header">
              <h3 class="section-title">📡 Network Host</h3>
              <div id="connection-badge" class="badge badge-warning">Disconnected</div>
            </div>
            <div id="host-name-display" style="margin-bottom: 16px; font-weight: 500; font-size: 1.1em; color: var(--text-secondary);">Searching for Host...</div>
            <button class="btn btn-primary w-full pulsate" id="btn-connect-host" style="font-size: 1.1em; padding: 12px;">🔌 Connect to Host</button>
          </div>

          <!-- Waveform -->
          <div class="glass-card">
            <div class="section-header">
              <h3 class="section-title">🎵 Audio Output</h3>
              <div id="playback-status" class="badge badge-warning">Waiting</div>
            </div>
            <div class="waveform-container" id="waveform-node">
              <canvas id="waveform-canvas-node"></canvas>
            </div>
          </div>

          <!-- Volume Control -->
          <div class="glass-card">
            <div class="section-header">
              <h3 class="section-title">🔊 Volume</h3>
              <span class="text-lg" id="volume-display" style="font-weight: 700; color: var(--accent-primary);">100%</span>
            </div>
            <input type="range" class="range-slider w-full" id="node-volume"
              min="0" max="100" value="100" style="margin-top: 8px;">
            <div class="flex flex-between" style="margin-top: 16px; gap: 8px;">
              <button class="btn btn-secondary btn-sm" id="btn-mute" style="flex:1;">🔇 Mute</button>
              <button class="btn btn-secondary btn-sm" id="btn-test-sound" style="flex:1;">🔔 Test Sound</button>
            </div>
            <button class="btn btn-outline w-full" id="btn-become-host" style="margin-top: 8px;">
              👑 Promote device to Host
            </button>
          </div>

          <!-- Calibration Control -->
          <div class="glass-card">
            <div class="section-header">
              <h3 class="section-title">⏱️ Sync Calibration</h3>
              <span class="text-lg" id="calibration-display" style="font-weight: 700; color: var(--accent-primary);">0ms</span>
            </div>
            <p class="text-xs text-secondary" style="margin-bottom: 12px;">
              Nudge this device forward/backward to fix echos. 
              <strong>Bluetooth?</strong> Usually needs +200ms.
            </p>
            <input type="range" class="range-slider w-full" id="node-calibration"
              min="-200" max="500" value="0" step="5" style="margin-top: 8px;">
            <div class="flex flex-between" style="margin-top: 16px; gap: 8px;">
              <div class="sync-button-container" style="flex:1;">
                <button class="btn btn-primary btn-sm w-full" id="btn-auto-sync">✨ Auto-Sync</button>
                <div class="sync-progress-bar" id="sync-progress-bar"></div>
              </div>
              <button class="btn btn-secondary btn-sm" id="btn-bt-fix" style="flex:1;">🎧 Bluetooth (+200)</button>
              <button class="btn btn-outline btn-sm" id="btn-reset-cal" style="flex:1;">🔄 Reset</button>
            </div>
            <div id="bt-advice" class="hidden text-xs text-warning" style="margin-top: 8px; text-align: center;">
              ⚠️ High latency detected. Likely Bluetooth? Click fix.
            </div>
          </div>

          <!-- Stats -->
          <div class="glass-card">
            <div class="section-header">
              <h3 class="section-title">📈 Stats</h3>
            </div>
            <div class="node-stats-grid" id="node-stats">
              <div class="stat-item">
                <span class="stat-value" id="stat-chunks">0</span>
                <span class="stat-label">Chunks Played</span>
              </div>
              <div class="stat-item">
                <span class="stat-value" id="stat-buffer">0</span>
                <span class="stat-label">Buffer Depth</span>
              </div>
              <div class="stat-item">
                <span class="stat-value" id="stat-latency">--</span>
                <span class="stat-label">Output Latency</span>
              </div>
              <div class="stat-item">
                <span class="stat-value" id="stat-rtt">--</span>
                <span class="stat-label">RTT (ms)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Calibration Success Modal -->
    <div class="modal-overlay hidden" id="modal-cal-success">
      <div class="modal glass-card">
        <div class="modal-icon">✅</div>
        <h2 class="modal-title">Tune-Up Complete!</h2>
        <p class="modal-body">
          SoundMesh has calculated your device's acoustic delay. Your offset is now set to 
          <strong class="text-accent" id="modal-offset-val">--ms</strong>.
        </p>
        <div class="modal-actions">
          <button class="btn btn-primary w-full" id="btn-modal-close">🚀 Looks Good!</button>
          <button class="btn btn-secondary w-full" id="btn-modal-test" style="margin-top: 8px;">🔊 Play Test Sound</button>
        </div>
      </div>
    </div>

    <style>
      .node-layout {
        max-width: 500px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-lg);
      }

      .sync-ring-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--space-xl);
      }

      .sync-ring {
        position: relative;
        width: 140px;
        height: 140px;
        margin-bottom: var(--space-md);
      }

      .sync-ring-svg {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        transform: rotate(-90deg);
      }

      .sync-ring-inner {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        z-index: 1;
      }

      .sync-ring-value {
        font-size: var(--font-size-3xl);
        font-weight: 800;
        color: var(--accent-primary);
        line-height: 1;
      }

      .sync-ring-label {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-top: 4px;
      }

      .sync-status-text {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }

      .node-stats-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--space-sm);
      }

      .stat-item {
        padding: var(--space-md);
        background: var(--bg-glass);
        border-radius: var(--radius-sm);
        text-align: center;
      }

      .stat-value {
        display: block;
        font-size: var(--font-size-xl);
        font-weight: 700;
        color: var(--accent-primary);
      }

      .stat-label {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      /* AuraSync Progress */
      .sync-button-container {
        position: relative;
        overflow: hidden;
        border-radius: var(--radius-sm);
      }
      .sync-progress-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 4px;
        width: 0%;
        background: var(--accent-primary);
        box-shadow: 0 0 8px var(--accent-primary);
        transition: width 0.3s ease;
        z-index: 5;
      }

      /* Modal Styles */
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        opacity: 0;
        animation: fadeIn 0.3s forwards;
      }
      .modal {
        width: 90%;
        max-width: 400px;
        padding: var(--space-xl);
        text-align: center;
        transform: translateY(20px);
        animation: slideUp 0.3s forwards;
      }
      .modal-icon {
        font-size: 3rem;
        margin-bottom: var(--space-md);
      }
      .modal-title {
        margin-bottom: var(--space-sm);
      }
      .modal-body {
        margin-bottom: var(--space-xl);
        color: var(--text-secondary);
      }

      @keyframes fadeIn { to { opacity: 1; } }
      @keyframes slideUp { to { transform: translateY(0); opacity: 1; } }
    </style>
  `,Xt(),Kt()}function Xt(){var c,u,d,h,r,p,y,b;document.addEventListener("devices-updated",f=>{const m=f.detail.devices.find(k=>k.role==="host"),w=document.getElementById("host-name-display");m&&w?(w.textContent=`${m.name} (${m.ip||"Unknown IP"})`,w.style.color="var(--text-primary)"):w&&(w.textContent="Searching for Host...",w.style.color="var(--text-secondary)")});const s=document.getElementById("btn-connect-host"),t=document.getElementById("connection-badge");s==null||s.addEventListener("click",async()=>{try{if(S.isPlaying)S.stop(),D&&(D(),D=null),document.getElementById("playback-status").textContent="Stopped",document.getElementById("playback-status").className="badge badge-warning",s.textContent="🔌 Connect to Host",s.className="btn btn-primary w-full pulsate",t.textContent="Disconnected",t.className="badge badge-warning",v("Disconnected from Host","info");else{await S.start(),v("Connected to Host Audio","success"),document.getElementById("playback-status").textContent="Playing",document.getElementById("playback-status").className="badge badge-success",s.textContent="🛑 Disconnect / Pause",s.className="btn btn-outline w-full",t.textContent="Connected",t.className="badge badge-success";const f=document.getElementById("waveform-canvas-node");f&&(D=rt(f,S.getAnalyser()));const m=S.getStats();x.send("latency_report",{outputLatency:m.outputLatency,btLatency:0})}}catch(f){v("Failed to connect: "+f.message,"error")}}),(c=document.getElementById("node-volume"))==null||c.addEventListener("input",f=>{const m=parseInt(f.target.value)/100;S.setVolume(m),document.getElementById("volume-display").textContent=`${f.target.value}%`}),(u=document.getElementById("btn-test-sound"))==null||u.addEventListener("click",async()=>{try{await S.playTestTone(),v("🔊 Playing test sound","info")}catch(f){v("Failed: "+f.message,"error")}}),(d=document.getElementById("btn-mute"))==null||d.addEventListener("click",()=>{S.toggleMute();const f=document.getElementById("btn-mute");S.muted?(f.textContent="🔊 Unmute",f.className="btn btn-primary btn-sm"):(f.textContent="🔇 Mute",f.className="btn btn-secondary btn-sm")}),(h=document.getElementById("btn-become-host"))==null||h.addEventListener("click",()=>{confirm("Are you sure you want to make this device the Host? The current host will become a standard Node.")&&x.send("switch_host",{targetDeviceId:g.deviceId})});const e=document.getElementById("node-calibration"),i=document.getElementById("calibration-display");e==null||e.addEventListener("input",f=>{const m=parseInt(f.target.value);S.setCalibrationOffset(m),i&&(i.textContent=(m>0?"+":"")+m+"ms")}),(r=document.getElementById("btn-bt-fix"))==null||r.addEventListener("click",()=>{e&&(e.value=200),S.setCalibrationOffset(200),i&&(i.textContent="+200ms"),v("Applied Bluetooth latency (+200ms)","success")}),(p=document.getElementById("btn-reset-cal"))==null||p.addEventListener("click",()=>{e&&(e.value=0),S.setCalibrationOffset(0),i&&(i.textContent="0ms")});const n=document.getElementById("btn-auto-sync"),a=document.getElementById("sync-progress-bar"),o=document.getElementById("modal-cal-success"),l=document.getElementById("modal-offset-val");n==null||n.addEventListener("click",()=>{v("Requesting sync pulses from host...","info"),x.send("request_acoustic_cal",{fromDeviceId:g.deviceId})}),E.on("detection_started",()=>{n&&(n.textContent="👂 Listening...",n.className="btn btn-warning btn-sm w-full pulsate"),a&&(a.style.width="0%")}),E.on("progress",f=>{a&&(a.style.width=`${f.percent}%`),n&&(n.textContent=`👂 Heard ${f.index+1}/${f.total}`)}),E.on("calibration_complete",f=>{n&&(n.textContent="✨ Auto-Sync",n.className="btn btn-primary btn-sm w-full"),a&&(a.style.width="0%"),e&&(e.value=f.offset,e.dispatchEvent(new Event("input"))),o&&l&&(l.textContent=`${f.offset.toFixed(1)}ms`,o.classList.remove("hidden"))}),E.on("calibration_failed",f=>{n&&(n.textContent="✨ Auto-Sync",n.className="btn btn-primary btn-sm w-full"),a&&(a.style.width="0%"),v("Sync Failed: "+f,"error")}),(y=document.getElementById("btn-modal-close"))==null||y.addEventListener("click",()=>{o==null||o.classList.add("hidden")}),(b=document.getElementById("btn-modal-test"))==null||b.addEventListener("click",async()=>{try{await S.playTestTone()}catch{}}),setTimeout(()=>{var m;S.getStats().outputLatency>80&&((m=document.getElementById("bt-advice"))==null||m.classList.remove("hidden"))},3e3)}function Kt(){V&&clearInterval(V),V=setInterval(()=>{const s=C.getStats(),t=C.getStatus(),e=document.getElementById("sync-offset-display");if(e){const h=Math.abs(s.avgOffset);e.textContent=h<100?h.toFixed(1):Math.round(h)}const i=document.getElementById("sync-ring-progress");if(i){const h=ut(t);i.setAttribute("stroke",h);const r=t==="in_sync"?339:t==="drifting"?200:100;i.setAttribute("stroke-dashoffset",339-r)}const n=document.getElementById("sync-status-dot"),a=document.getElementById("sync-status-label");n&&(n.className=`status-dot status-dot--${t==="in_sync"?"synced":t==="drifting"?"drifting":"error"}`),a&&(a.textContent=t==="in_sync"?"Perfectly synced":t==="drifting"?"Slight drift detected":t==="unknown"?"Waiting for sync...":"Out of sync — resyncing...");const o=S.getStats(),l=document.getElementById("stat-chunks"),c=document.getElementById("stat-buffer"),u=document.getElementById("stat-latency"),d=document.getElementById("stat-rtt");l&&(l.textContent=o.chunksPlayed),c&&(c.textContent=o.bufferDepth),u&&(u.textContent=o.outputLatency.toFixed(1)),d&&(d.textContent=s.avgRtt>0?s.avgRtt.toFixed(1):"--")},200)}const g={role:null,deviceId:null,session:null,devices:[],currentPage:"landing",isAudioActive:!1};function Jt(){Rt(),x.connect(),x.on("welcome",s=>{g.role=s.role,g.deviceId=s.deviceId,g.session=s.session,g.devices=s.devices||[],console.log(`[App] Role: ${g.role}, Device: ${g.deviceId}`),C.start(),g.role==="host"?it("host"):it("node")}),x.on("device_joined",s=>{g.devices.findIndex(e=>e.deviceId===s.deviceId)===-1&&g.devices.push(s),O()}),x.on("device_left",({deviceId:s})=>{g.devices=g.devices.filter(t=>t.deviceId!==s),O()}),x.on("device_updated",s=>{const t=g.devices.find(e=>e.deviceId===s.deviceId);if(t&&Object.assign(t,s),g.role==="node"&&s.deviceId===g.deviceId&&s.position!==void 0){const e=s.position==="unassigned"?"unassigned":z[s.position];S.updateSurroundState(e),v(`Surround Channel: ${s.position}`,"info")}O()}),x.on("placement_changed",({deviceId:s,position:t})=>{const e=g.devices.find(i=>i.deviceId===s);if(e&&(e.position=t),s===g.deviceId){const i=t==="unassigned"?"unassigned":z[t];S.updateSurroundState(i),v(`Local placement: ${t==="unassigned"?"Stereo":t}`,"info")}O()}),x.on("playback_state_changed",async s=>{g.role==="node"&&(s.isPlaying?(console.log("[App] Host started streaming"),g.isAudioActive=!0):(console.log("[App] Host stopped streaming"),g.isAudioActive=!1,S.stop(),v("Audio stream stopped","info")))}),x.on("audio_data",s=>{S.isPlaying&&S.receiveChunk(s)}),x.on("set_volume",({volume:s})=>{S.setVolume(s)}),x.on("trigger_test_tone",async()=>{if(g.role==="node")try{await S.playTestTone(),v("🔔 Host triggered test tone","info")}catch(s){console.warn("Failed to play test tone:",s)}}),x.on("start_acoustic_cal",s=>{const t=s.targetDeviceId!==null,e=s.targetDeviceId===g.deviceId;g.role==="node"?(!t||e)&&E.handleCalRequest(s):g.role==="host"&&E.playPulses(s.startTime,s.pulseInterval,s.pulseCount)}),x.on("request_acoustic_cal",({fromDeviceId:s})=>{g.role==="host"&&(console.log(`[App] Node ${s} requested individual recalibration. Targeting...`),E.startHostCalibration(s))}),x.on("force_reload",()=>{S.stop(),I.stop(),T.stop(),v("Role updated, resetting engine...","info"),setTimeout(()=>window.location.reload(),800)}),x.on("disconnected",()=>{v("Connection lost. Reconnecting...","warning")}),x.on("connected",()=>{g.role&&v("Reconnected!","success")}),x.on("reconnect_failed",()=>{v("Could not reconnect to host. Please refresh.","error")}),ot()}function it(s){switch(g.currentPage=s,document.getElementById("app"),s){case"landing":ot();break;case"host":ct();break;case"node":Yt();break}}let nt;function O(){clearTimeout(nt),nt=setTimeout(()=>{switch(g.currentPage){case"host":Zt();break;case"node":Qt();break}},50)}function Zt(){if(!document.getElementById("device-list"))return;const t=new CustomEvent("devices-updated",{detail:{devices:g.devices}});document.dispatchEvent(t)}function Qt(){const s=new CustomEvent("node-status-updated");document.dispatchEvent(s)}function v(s,t="info"){const e=document.querySelector(".toast");e&&e.remove();const i=document.createElement("div");i.className=`toast toast-${t}`,i.innerHTML=`
    <span class="toast-icon">${t==="success"?"✓":t==="error"?"✕":t==="warning"?"⚠":"ℹ"}</span>
    <span class="toast-message">${s}</span>
  `,Object.assign(i.style,{position:"fixed",bottom:"24px",left:"50%",transform:"translateX(-50%) translateY(20px)",padding:"12px 24px",background:t==="error"?"rgba(255, 23, 68, 0.9)":t==="success"?"rgba(0, 230, 118, 0.9)":t==="warning"?"rgba(255, 145, 0, 0.9)":"rgba(0, 229, 255, 0.9)",color:t==="warning"||t==="success"?"#000":"#fff",borderRadius:"12px",fontFamily:"var(--font-family)",fontWeight:"600",fontSize:"14px",zIndex:"1000",display:"flex",alignItems:"center",gap:"8px",backdropFilter:"blur(12px)",boxShadow:"0 8px 32px rgba(0,0,0,0.3)",opacity:"0",transition:"all 0.3s ease"}),document.body.appendChild(i),requestAnimationFrame(()=>{i.style.opacity="1",i.style.transform="translateX(-50%) translateY(0)"}),setTimeout(()=>{i.style.opacity="0",i.style.transform="translateX(-50%) translateY(20px)",setTimeout(()=>i.remove(),300)},3e3)}document.addEventListener("DOMContentLoaded",Jt);
