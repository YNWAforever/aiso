# T27 / F56-F57 / UC50-52, UC70-71

Fixed actual stale scope display: a new query/retry now derives loading rather than showing previous result/error beneath a new account/view. Existing AbortController still ignores late responses; query input reflects the current saved query. Current scope is explicit. Response shape/page bounds validated. Existing server Admin guard, tagged SQL and field whitelist retained without architecture rewrite.

Local RED2/2 actual component failures. Final40/40 targeted unit/API/offlineSQL/component and30/30 actual Chromium cases,0skip;lint/typecheck0. Everyview has>=26syntheticSQL records with deterministicpaging/no duplicates/no omission, selectedA/Bscope, literal search andexplicitfields. BrowsercoversnineviewsEN/zh-HK,25+1paging,filter/searchreset,loading/empty403503retry,uncancellablelateAresponse, andthree schema states withvisiblecheckedAt. Stronger final30-case rerun waitsforactuallate response. PGliteisdisposablePostgreSQL-compatibleofflineengine; it is not hosted Neon or app-role/session evidence. Accountdirectoryneeds26distinct syntheticaccounts, withA/B selected explicitly; other businessviewsuseA/Bdata. No token/password/DSN/session returned.

Schema columns_present means visible requiredcolumns only; not migrationequivalence, grants, provider or productready. No DDL/button added. Offline engines closed; browserfixturesretained forevidence. HostedAdminpositiveacceptanceblocked byT26identityandaccess.

Rollback: compatibleUIrevert;preserveSQLguard/whitelistandbusinessdata.
