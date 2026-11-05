/** A cancelled request cannot publish late success or failure, even if its loader ignores abort. */
export function pageReadRequest<T>(load:(signal:AbortSignal)=>Promise<T>,success:(value:T)=>void,failure:(message:string)=>void){
  const request=new AbortController();
  void Promise.resolve().then(()=>{if(request.signal.aborted)return;return load(request.signal);}).then(value=>{
    if(!request.signal.aborted)success(value as T);
  }).catch(reason=>{if(!request.signal.aborted)failure(reason instanceof Error?reason.message:'Не удалось загрузить данные.');});
  return ()=>request.abort();
}
