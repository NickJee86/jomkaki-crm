param(
  [Parameter(Mandatory = $true)][string]$SourceDirectory,
  [Parameter(Mandatory = $true)][string]$DestinationDirectory
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force -Path $DestinationDirectory | Out-Null

function Read-Blueprint([string]$pattern) {
  $source = Get-ChildItem -LiteralPath $SourceDirectory -File | Where-Object Name -Like $pattern | Select-Object -First 1
  if (-not $source) { throw "Blueprint not found: $pattern" }
  return Get-Content -Raw -Encoding UTF8 -LiteralPath $source.FullName | ConvertFrom-Json
}

function Save-Blueprint($value, [string]$name) {
  $json = $value | ConvertTo-Json -Depth 100
  [IO.File]::WriteAllText((Join-Path $DestinationDirectory $name), $json, $utf8)
}

function Clone-Value($value) {
  return ($value | ConvertTo-Json -Depth 100 | ConvertFrom-Json)
}

function Set-ModuleFilter($module, $filter) {
  if ($module.PSObject.Properties.Name -contains 'filter') { $module.filter = $filter }
  else { $module | Add-Member -NotePropertyName filter -NotePropertyValue $filter }
}

function New-UpdateCellModule($template, [int]$id, [string]$cell, [string]$value, [string]$name, $filter = $null) {
  $module = Clone-Value $template
  $module.id = $id
  $module.mapper.cell = $cell
  $module.mapper.value = $value
  if ($module.metadata.designer.PSObject.Properties.Name -contains 'name') { $module.metadata.designer.name = $name }
  else { $module.metadata.designer | Add-Member -NotePropertyName name -NotePropertyValue $name }
  if ($filter) { Set-ModuleFilter $module $filter }
  elseif ($module.PSObject.Properties.Name -contains 'filter') { $module.PSObject.Properties.Remove('filter') }
  return $module
}

$s06Name = 'S06*Application Details Collection.blueprint.json'
$s06 = Read-Blueprint $s06Name
$s06.name = 'S06 - Application Details Collection and Automated Consent'
$s06Json = $s06 | ConvertTo-Json -Depth 100 -Compress
$s06Json = $s06Json.Replace('Terima kasih. Semua maklumat permohonan telah lengkap dan kini sedia untuk semakan seterusnya.', 'Terima kasih. Semua dokumen dan maklumat permohonan telah lengkap. Sila muat turun, lengkapkan dan tandatangani Borang Kebenaran CTOS/CCRIS ini, kemudian hantar semula PDF atau gambar yang jelas di WhatsApp ini: https://jomkaki-rider.vercel.app/assets/ctos-ccris-consent-bph-v4.pdf')
$s06Json = $s06Json.Replace('JKM_S06_APPLICATION_DETAILS_COMPLETE', 'JKM_CREDIT_CONSENT_REQUEST')
$s06Json = $s06Json.Replace('APPLICATION_DETAILS_COMPLETE', 'CONSENT_PENDING_SIGNATURE')
$s06 = $s06Json | ConvertFrom-Json
$outbox06 = $s06.flow | Where-Object id -eq 16
$outbox06.mapper.values | Add-Member -NotePropertyName 'WhatsApp Number ID' -NotePropertyValue '{{2.`16`}}' -Force
$outbox06.mapper.values | Add-Member -NotePropertyName 'WABA ID' -NotePropertyValue '{{2.`18`}}' -Force
$outbox06.mapper.values | Add-Member -NotePropertyName 'Internal Channel ID' -NotePropertyValue '{{2.`25`}}' -Force
$outbox06.mapper.values | Add-Member -NotePropertyName 'Reply To Message ID' -NotePropertyValue '{{2.`5`}}' -Force
$outbox06.mapper.values | Add-Member -NotePropertyName 'Send Routing Status' -NotePropertyValue 'AUTO_AI_CONVERSATION' -Force
$outbox06.mapper.values | Add-Member -NotePropertyName 'Business Unit' -NotePropertyValue '{{2.`26`}}' -Force
$outbox06.mapper.values | Add-Member -NotePropertyName 'Customer ID' -NotePropertyValue '{{2.`27`}}' -Force
$outbox06.mapper.values | Add-Member -NotePropertyName 'Team ID' -NotePropertyValue '{{2.`28`}}' -Force

$validBank = '{{if(lower(trim(2.`2`)) = "ya"; true; if(lower(trim(2.`2`)) = "yes"; true; if(contains(lower(2.`2`); "ada akaun"); true; if(lower(trim(2.`2`)) = "tidak"; true; if(lower(trim(2.`2`)) = "no"; true; if(lower(trim(2.`2`)) = "tak"; true; if(contains(lower(2.`2`); "tiada"); true; false)))))))}}'
$finalFilter = [pscustomobject]@{
  name = 'Final Application Detail Valid - Queue Consent Automatically'
  conditions = @(, @(
    [pscustomobject]@{ a = '{{4.`4`}}'; b = 'APP_DETAILS_BANK_ACCOUNT'; o = 'text:equal:ci' },
    [pscustomobject]@{ a = $validBank; b = 'true'; o = 'text:equal:ci' }
  ))
}
$updateTemplate06 = $s06.flow | Where-Object id -eq 7
$m20 = New-UpdateCellModule $updateTemplate06 20 'BT{{3.`__ROW_NUMBER__`}}' 'QUEUED' 'Consent - Queue Automatic Delivery' $finalFilter
$m21 = New-UpdateCellModule $updateTemplate06 21 'BU{{3.`__ROW_NUMBER__`}}' 'BPH_V4.0_01112020' 'Consent - Record Template Version'
$m22 = New-UpdateCellModule $updateTemplate06 22 'CA{{3.`__ROW_NUMBER__`}}' 'BLOCKED_CONSENT_REQUIRED' 'Consent - Keep Credit and LMS Gate Locked'
$m23 = New-UpdateCellModule $updateTemplate06 23 'D{{3.`__ROW_NUMBER__`}}' '{{now}}' 'Application - Update Automated Consent Timestamp'
$s06.flow = @($s06.flow) + @($m20, $m21, $m22, $m23)
Save-Blueprint $s06 'S06 - Application Details and Automated Consent.blueprint.json'

$s04Name = 'S04*Document Collection & Receive Engine.blueprint.json'
$s04 = Read-Blueprint $s04Name
$s04.name = 'S04 - Document and Signed Consent AI Validation'
$vision = $s04.flow | Where-Object id -eq 6
$vision.mapper.prompt = 'Classify and validate the uploaded JomKaki Rider customer document. Return ONLY one exact label: IC_FRONT, IC_BACK, PAYSLIP, BANK_STATEMENT, EPF_STATEMENT, CTOS_CCRIS_CONSENT_SIGNED, CTOS_CCRIS_CONSENT_UNSIGNED, or UNKNOWN. CTOS_CCRIS_CONSENT_SIGNED means the BPH/JomKaki CTOS/CCRIS consent authorisation form is present, the applicant details are substantially completed, and a clear applicant signature or mark is visible. CTOS_CCRIS_CONSENT_UNSIGNED means that consent form is present but the signature or essential applicant details are missing or unclear. Use UNKNOWN if unclear, unsupported, unrelated, or not confidently identifiable. Do not return markdown, explanation, punctuation, or any other text.'
$router04 = $s04.flow | Where-Object id -eq 11
$supportedRoute = $router04.routes[0]
$documentAdd = $supportedRoute.flow | Where-Object id -eq 7
$documentAdd.mapper.values.'5' = '{{if(6.result = "CTOS_CCRIS_CONSENT_SIGNED"; "CTOS_CCRIS_CONSENT"; if(6.result = "CTOS_CCRIS_CONSENT_UNSIGNED"; "CTOS_CCRIS_CONSENT"; 6.result))}}'
$documentAdd.mapper.values.'13' = '{{if(6.result = "UNKNOWN"; "UNKNOWN"; "CLASSIFIED")}}'
$documentAdd.mapper.values.'14' = '{{if(6.result = "CTOS_CCRIS_CONSENT_SIGNED"; "GOOD"; if(6.result = "CTOS_CCRIS_CONSENT_UNSIGNED"; "RESUBMISSION_REQUIRED"; if(6.result = "UNKNOWN"; "UNSUPPORTED"; "PENDING")))}}'
$documentAdd.mapper.values.'15' = '{{if(6.result = "CTOS_CCRIS_CONSENT_SIGNED"; "VERIFIED"; if(6.result = "CTOS_CCRIS_CONSENT_UNSIGNED"; "REUPLOAD_REQUIRED"; if(6.result = "UNKNOWN"; "REUPLOAD_REQUIRED"; "PENDING")))}}'
$documentAdd.mapper.values.'21' = '{{if(6.result = "CTOS_CCRIS_CONSENT_SIGNED"; 98; if(6.result = "CTOS_CCRIS_CONSENT_UNSIGNED"; 92; if(6.result = "UNKNOWN"; 40; 90)))}}'
$documentAdd.mapper.values.'22' = '{{if(6.result = "UNKNOWN"; "TRUE"; "FALSE")}}'
$documentAdd.mapper.values.'23' = 'S04_GPT5_MINI_DOCUMENT_AND_CONSENT_VALIDATION'

$applicationRouter = $supportedRoute.flow | Where-Object id -eq 14
$route2First = $applicationRouter.routes[1].flow | Where-Object id -eq 16
$route2First.filter.conditions[0] += [pscustomobject]@{ a = '{{6.result}}'; b = 'CTOS_CCRIS_CONSENT_SIGNED'; o = 'text:notequal' }
$route2First.filter.conditions[0] += [pscustomobject]@{ a = '{{6.result}}'; b = 'CTOS_CCRIS_CONSENT_UNSIGNED'; o = 'text:notequal' }

$consentGroups = @()
$consentGroups += ,@(
  [pscustomobject]@{ a = '{{13.`__ROW_NUMBER__`}}'; o = 'exist' },
  [pscustomobject]@{ a = '{{6.result}}'; b = 'CTOS_CCRIS_CONSENT_SIGNED'; o = 'text:equal:ci' }
)
$consentGroups += ,@(
  [pscustomobject]@{ a = '{{13.`__ROW_NUMBER__`}}'; o = 'exist' },
  [pscustomobject]@{ a = '{{6.result}}'; b = 'CTOS_CCRIS_CONSENT_UNSIGNED'; o = 'text:equal:ci' }
)
$consentFilter = [pscustomobject]@{ name = 'Signed Consent - AI Validation Result'; conditions = $consentGroups }
$updateTemplate04 = Clone-Value $route2First
$m24 = New-UpdateCellModule $updateTemplate04 24 'BT{{13.`__ROW_NUMBER__`}}' '{{if(6.result = "CTOS_CCRIS_CONSENT_SIGNED"; "VERIFIED"; "REJECTED_RESUBMISSION_REQUIRED")}}' 'Consent - Save AI Validation Result' $consentFilter
$m25 = New-UpdateCellModule $updateTemplate04 25 'BU{{13.`__ROW_NUMBER__`}}' 'BPH_V4.0_01112020' 'Consent - Save Template Version'
$m26 = New-UpdateCellModule $updateTemplate04 26 'BW{{13.`__ROW_NUMBER__`}}' '{{now}}' 'Consent - Save Customer Signed Time'
$m27 = New-UpdateCellModule $updateTemplate04 27 'BX{{13.`__ROW_NUMBER__`}}' '{{if(6.result = "CTOS_CCRIS_CONSENT_SIGNED"; now; emptystring)}}' 'Consent - Save AI Verified Time'
$m28 = New-UpdateCellModule $updateTemplate04 28 'BY{{13.`__ROW_NUMBER__`}}' '{{if(6.result = "CTOS_CCRIS_CONSENT_SIGNED"; "AI_S04_CONSENT_VALIDATOR"; emptystring)}}' 'Consent - Save AI Validator'
$m29 = New-UpdateCellModule $updateTemplate04 29 'BZ{{13.`__ROW_NUMBER__`}}' 'DOC-{{2.`5`}}' 'Consent - Link Signed Document'
$m30 = New-UpdateCellModule $updateTemplate04 30 'CA{{13.`__ROW_NUMBER__`}}' '{{if(6.result = "CTOS_CCRIS_CONSENT_SIGNED"; "READY_FOR_CREDIT_CHECK"; "BLOCKED_CONSENT_REJECTED")}}' 'Consent - Apply Credit and LMS Gate'
$m31 = New-UpdateCellModule $updateTemplate04 31 'F{{13.`__ROW_NUMBER__`}}' '{{if(6.result = "CTOS_CCRIS_CONSENT_SIGNED"; "CONSENT_VERIFIED"; "CONSENT_RESUBMISSION_REQUIRED")}}' 'Application - Advance or Request Consent Again'
$m32 = Clone-Value $documentAdd
$m32.id = 32
if ($m32.metadata.designer.PSObject.Properties.Name -contains 'name') { $m32.metadata.designer.name = 'Message - Confirm Consent or Request Resubmission' }
else { $m32.metadata.designer | Add-Member -NotePropertyName name -NotePropertyValue 'Message - Confirm Consent or Request Resubmission' }
if ($m32.PSObject.Properties.Name -contains 'filter') { $m32.PSObject.Properties.Remove('filter') }
$m32.mapper = [pscustomobject]@{
  mode = 'fromAll'
  values = [pscustomobject]@{
    'Outbox ID' = 'S04-CONSENT-{{2.`5`}}'
    'Created At' = '{{now}}'
    'Lead ID' = '{{2.`8`}}'
    'Application ID' = '{{2.`9`}}'
    'Phone Number' = '{{2.`1`}}'
    'Message Type' = 'SESSION_TEXT'
    'Message Text' = '{{if(6.result = "CTOS_CCRIS_CONSENT_SIGNED"; "Terima kasih. Borang kebenaran CTOS/CCRIS anda telah diterima dan disahkan secara automatik. Permohonan anda kini bergerak ke persediaan LMS."; "Borang kebenaran CTOS/CCRIS yang diterima belum lengkap atau tandatangan tidak jelas. Sila lengkapkan dan tandatangani borang, kemudian hantar semula PDF atau gambar yang jelas: https://jomkaki-rider.vercel.app/assets/ctos-ccris-consent-bph-v4.pdf")}}'
    'Template Name' = '{{if(6.result = "CTOS_CCRIS_CONSENT_SIGNED"; "JKM_CONSENT_VERIFIED"; "JKM_CONSENT_RESUBMISSION_REQUIRED")}}'
    'Language' = 'ms_MY'
    'Scheduled At' = '{{now}}'
    'Send Status' = 'PENDING'
    'Attempt Count' = '0'
    'WhatsApp Number ID' = '{{2.`16`}}'
    'WABA ID' = '{{2.`18`}}'
    'Internal Channel ID' = '{{2.`25`}}'
    'Reply To Message ID' = '{{2.`5`}}'
    'Send Routing Status' = 'AUTO_CONSENT_VALIDATION_REPLY'
    'Business Unit' = '{{2.`26`}}'
    'Customer ID' = '{{2.`27`}}'
    'Team ID' = '{{2.`28`}}'
  }
  sheetId = 'Message_Outbox'
  spreadsheetId = '10hnumWmBfzupDrR8Ewl6hns_9hwA9qe_glF68bgOaNE'
  includesHeaders = $true
  insertDataOption = 'INSERT_ROWS'
  useColumnHeaders = $true
  valueInputOption = 'USER_ENTERED'
  insertUnformatted = $false
}
$applicationRouter.routes = @($applicationRouter.routes) + @([pscustomobject]@{ flow = @($m24, $m25, $m26, $m27, $m28, $m29, $m30, $m31, $m32) })
Save-Blueprint $s04 'S04 - Document and Signed Consent AI Validation.blueprint.json'

$s05Name = 'S05*Document Verification & Completeness Engine.blueprint.json'
$s05 = Read-Blueprint $s05Name
$s05.name = 'S05 - Routine Document Completeness (Consent Excluded)'
$validDocuments = $s05.flow | Where-Object id -eq 5
$validDocuments.filter.conditions[0] += [pscustomobject]@{ a = '{{2.`5`}}'; b = 'CTOS_CCRIS_CONSENT'; o = 'text:notequal' }
Save-Blueprint $s05 'S05 - Routine Documents (Consent Excluded).blueprint.json'

$s07Name = 'S07*LMS Readiness & Document Combination Protection.blueprint.json'
$s07 = Read-Blueprint $s07Name
$s07.name = 'S07 - LMS Readiness, Documents and Consent Protection'
$applicationSearch = $s07.flow | Where-Object id -eq 1
foreach ($group in $applicationSearch.mapper.filter) { $group[0].b = 'CONSENT_VERIFIED' }
$router07 = $s07.flow | Where-Object id -eq 4
$ready07 = $router07.routes[1].flow | Where-Object id -eq 7
$newReadyGroups = @()
foreach ($group in $ready07.filter.conditions) {
  $extended = @($group) + @([pscustomobject]@{ a = '{{1.`71`}}'; b = 'VERIFIED'; o = 'text:equal:ci' })
  $newReadyGroups += ,$extended
}
$ready07.filter.conditions = $newReadyGroups
$blockedAudit = $router07.routes[0].flow | Where-Object id -eq 6
$blockedAudit.mapper.values.Description = 'Readiness blocked because the protected minimum document combination and AI-verified CTOS/CCRIS consent were not both satisfied. No LMS submission was performed.'
$readyAudit = $router07.routes[1].flow | Where-Object id -eq 10
$readyAudit.mapper.values.Description = 'Minimum protected documents, complete application details and AI-verified CTOS/CCRIS consent confirmed. Marked READY only; no LMS submission was performed.'
Save-Blueprint $s07 'S07 - LMS Readiness with Consent Gate.blueprint.json'

Get-ChildItem -LiteralPath $DestinationDirectory -Filter '*.blueprint.json' | Select-Object Name, Length
