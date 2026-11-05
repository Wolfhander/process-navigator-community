export function PageReadState({error,loading,onRetry}:{error?:string;loading:string;onRetry:()=>void}){
  return error?<section role="alert" className="import-message is-error"><p>{error}</p><button onClick={onRetry}>Повторить загрузку</button></section>:
    <div role="status" className="editor-loading"><div className="loader"/>{loading}</div>;
}
