param([Parameter(Mandatory=$true)][string]$WorkbookPath)
$ErrorActionPreference='Stop'
# Test-only transformation of our exported artifact, never a user workbook.
$repoRoot=Split-Path $PSScriptRoot -Parent
$artifactRoot=[IO.Path]::GetFullPath((Join-Path $repoRoot 'artifacts'))+[IO.Path]::DirectorySeparatorChar
$targetPath=(Resolve-Path -LiteralPath $WorkbookPath).Path
if(-not $targetPath.StartsWith($artifactRoot,[StringComparison]::OrdinalIgnoreCase) -or
   -not [IO.Path]::GetFileName($targetPath).StartsWith('wait-reference-') -or
   [IO.Path]::GetExtension($targetPath) -ne '.xlsx'){throw 'Only a generated wait-reference XLSX artifact is allowed.'}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::Open($targetPath,[IO.Compression.ZipArchiveMode]::Update)
try{
 function Read-ZipXml([string]$entryName){
  $sourceEntry=$archive.GetEntry($entryName);if($null -eq $sourceEntry){throw 'Workbook metadata is missing.'}
  $streamReader=[IO.StreamReader]::new($sourceEntry.Open())
  try{$text=$streamReader.ReadToEnd()}finally{$streamReader.Dispose()}
  $doc=[xml]::new();$doc.XmlResolver=$null;$doc.LoadXml($text);return ,$doc
 }
 $workbook=Read-ZipXml 'xl/workbook.xml'
 $sheetInfo=@($workbook.DocumentElement.ChildNodes | Where-Object LocalName -eq 'sheets')[0].ChildNodes | Where-Object { $_.GetAttribute('name') -eq 'Шаги' }
 if($null -eq $sheetInfo){throw 'Steps sheet metadata is missing.'}
 $relationshipId=$sheetInfo.GetAttribute('id','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
 $relationships=Read-ZipXml 'xl/_rels/workbook.xml.rels'
 $relationship=$relationships.DocumentElement.ChildNodes | Where-Object { $_.GetAttribute('Id') -eq $relationshipId }
 $relativeTarget=$relationship.GetAttribute('Target')
 $sheetPath=if($relativeTarget.StartsWith('/')){$relativeTarget.TrimStart('/')}else{'xl/'+$relativeTarget}
 if($sheetPath -notmatch '^xl/worksheets/sheet[0-9]+\.xml$'){throw 'Unexpected steps sheet target.'}
 $entry=$archive.GetEntry($sheetPath)
 if($null -eq $entry){throw 'Expected steps sheet is missing.'}
 $reader=[IO.StreamReader]::new($entry.Open())
 try{$xmlText=$reader.ReadToEnd()}finally{$reader.Dispose()}
 $document=[xml]::new();$document.XmlResolver=$null;$document.LoadXml($xmlText)
 $namespaces=[Xml.XmlNamespaceManager]::new($document.NameTable)
 $namespaces.AddNamespace('s','http://schemas.openxmlformats.org/spreadsheetml/2006/main')
 $cells=@($document.SelectNodes('//s:sheetData/s:row/s:c[starts-with(@r,"AG")]',$namespaces))
 if($cells.Count -eq 0){throw 'Wait column was not exported; fixture cannot simulate the old format.'}
 foreach($cell in $cells){[void]$cell.ParentNode.RemoveChild($cell)}
 $entry.Delete()
 $newEntry=$archive.CreateEntry($sheetPath)
 $writer=[IO.StreamWriter]::new($newEntry.Open(),[Text.UTF8Encoding]::new($false))
 try{$writer.Write($document.OuterXml)}finally{$writer.Dispose()}
}finally{$archive.Dispose()}
Write-Output 'Prepared legacy XLSX without the wait-event column.'
