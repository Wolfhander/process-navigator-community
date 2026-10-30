import {validationProfiles,profileResult,profileQuality,type ValidationProfile,type QualityInput} from './validation-profiles';
import './validation-profiles.css';
export function ValidationProfilePanel({profile,onChange,input,inputLabel}:{profile:ValidationProfile;onChange:(profile:ValidationProfile)=>void;input?:QualityInput;inputLabel?:string}) {
  return <section className="validation-profile-panel" aria-label="Профиль проверки качества">
    <label>Профиль проверки <select value={profile} onChange={event=>onChange(event.target.value as ValidationProfile)}>{Object.entries(validationProfiles).map(([id,item])=><option key={id} value={id}>{item.label}</option>)}</select></label>
    <p>{validationProfiles[profile].description}</p>
    {input&&<div className={'profile-result is-'+profileQuality(input,profile).toLowerCase()}>{inputLabel&&<span>Выбранная редакция: {inputLabel}</span>}<strong>{profileResult(input,profile)}</strong><span>Полный отчёт: ошибок {input.errorCount}, рекомендаций {input.warningCount}. {profile==='minimum'?'Рекомендации скрыты только в списке этого профиля.':''}</span></div>}
  </section>;
}
