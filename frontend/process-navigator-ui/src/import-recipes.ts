export type RecipeRule={kind:string;value:string;scope:string;targetId?:string;keepNew:boolean};
export type RecipeFile={id:string;fileName:string;size:number;sha256:string};
export type RecipeBatch={id:string;createdAt:string;files:RecipeFile[]};
export type ImportRecipe={schemaVersion:number;id:string;ownerId:string;name:string;revision:number;createdAt:string;rules:RecipeRule[];batches:RecipeBatch[]};
export type RecipeFilePreview={fileId:string;fileName:string;state:'ready'|'needsMapping'|'blocked';appliedRules:number;unusedRules:number;remainingGroups:number;errorCount:number;warningCount:number;fingerprint?:string;messages:string[]};
export type RecipePreview={recipeId:string;revision:number;batchId:string;files:RecipeFilePreview[]};
export function mergeRecipeRules(previous:RecipeRule[],incoming:RecipeRule[]) {
  const key=(r:RecipeRule)=>JSON.stringify([r.kind,r.value,r.scope]);
  return [...new Map([...previous,...incoming].map(r=>[key(r),r])).values()];
}
