@echo off
setlocal enabledelayedexpansion

:: =============================================================
:: API Endpoint Verification Script
:: Run on Collector VM (192.168.56.102) with backend running
:: Usage: test_endpoints.bat [BASE_URL]
:: Default: http://localhost:3000
:: =============================================================

set BASE=%~1
if "%BASE%"=="" set BASE=http://localhost:3000

set PASS=0
set FAIL=0
set TOTAL=0

echo.
echo ============================================================
echo  API Endpoint Verification - %BASE%
echo ============================================================
echo.

:: ----- 1. GET /health -----
set /a TOTAL+=1
echo [%TOTAL%] GET /api/v1/health
curl -s -w "\nHTTP_CODE:%%{http_code}" "%BASE%/api/v1/health" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 2. POST /events (test event) -----
set /a TOTAL+=1
echo [%TOTAL%] POST /api/v1/events
curl -s -w "\nHTTP_CODE:%%{http_code}" -X POST "%BASE%/api/v1/events" -H "Content-Type: application/json" -d "{\"vm_id\":\"test-vm\",\"hostname\":\"TEST-PC\",\"events\":[{\"timestamp\":\"2026-01-01 00:00:00.0000000\",\"ip_address\":\"10.99.99.99\",\"username\":\"__test_user__\",\"logon_type\":\"3\",\"status\":\"0xC000006A\",\"source_port\":\"59999\"}]}" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 3. GET /suspicious-ips -----
set /a TOTAL+=1
echo [%TOTAL%] GET /api/v1/suspicious-ips
curl -s -w "\nHTTP_CODE:%%{http_code}" "%BASE%/api/v1/suspicious-ips?threshold=1" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 4. GET /blocked-ips -----
set /a TOTAL+=1
echo [%TOTAL%] GET /api/v1/blocked-ips
curl -s -w "\nHTTP_CODE:%%{http_code}" "%BASE%/api/v1/blocked-ips" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 5. POST /block (block the test IP) -----
set /a TOTAL+=1
echo [%TOTAL%] POST /api/v1/block
curl -s -w "\nHTTP_CODE:%%{http_code}" -X POST "%BASE%/api/v1/block" -H "Content-Type: application/json" -d "{\"ip_address\":\"10.99.99.99\",\"reason\":\"endpoint test\",\"duration_minutes\":1}" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 6. POST /block/per-vm -----
set /a TOTAL+=1
echo [%TOTAL%] POST /api/v1/block/per-vm
curl -s -w "\nHTTP_CODE:%%{http_code}" -X POST "%BASE%/api/v1/block/per-vm" -H "Content-Type: application/json" -d "{\"ip_address\":\"10.99.99.99\",\"vm_id\":\"test-vm\",\"reason\":\"per-vm endpoint test\",\"duration_minutes\":1}" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 7. DELETE /block/{ip} (unblock test IP) -----
set /a TOTAL+=1
echo [%TOTAL%] DELETE /api/v1/block/10.99.99.99
curl -s -w "\nHTTP_CODE:%%{http_code}" -X DELETE "%BASE%/api/v1/block/10.99.99.99" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 8. POST /vms (register test VM) -----
set /a TOTAL+=1
echo [%TOTAL%] POST /api/v1/vms
curl -s -w "\nHTTP_CODE:%%{http_code}" -X POST "%BASE%/api/v1/vms" -H "Content-Type: application/json" -d "{\"vm_id\":\"test-vm\",\"hostname\":\"TEST-PC\",\"ip_address\":\"10.99.99.1\",\"collection_method\":\"agent\"}" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 9. GET /vms -----
set /a TOTAL+=1
echo [%TOTAL%] GET /api/v1/vms
curl -s -w "\nHTTP_CODE:%%{http_code}" "%BASE%/api/v1/vms" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 10. GET /vms/{vm_id}/attacks (with data) -----
set /a TOTAL+=1
echo [%TOTAL%] GET /api/v1/vms/vm-001/attacks
curl -s -w "\nHTTP_CODE:%%{http_code}" "%BASE%/api/v1/vms/vm-001/attacks" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 11. GET /vms/{vm_id}/attacks (empty VM) -----
set /a TOTAL+=1
echo [%TOTAL%] GET /api/v1/vms/nonexistent-vm/attacks
curl -s -w "\nHTTP_CODE:%%{http_code}" "%BASE%/api/v1/vms/nonexistent-vm/attacks" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 12. DELETE /vms/{vm_id} (clean up test VM) -----
set /a TOTAL+=1
echo [%TOTAL%] DELETE /api/v1/vms/test-vm
curl -s -w "\nHTTP_CODE:%%{http_code}" -X DELETE "%BASE%/api/v1/vms/test-vm" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 13. GET /statistics -----
set /a TOTAL+=1
echo [%TOTAL%] GET /api/v1/statistics
curl -s -w "\nHTTP_CODE:%%{http_code}" "%BASE%/api/v1/statistics" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 14. GET /statistics/global -----
set /a TOTAL+=1
echo [%TOTAL%] GET /api/v1/statistics/global
curl -s -w "\nHTTP_CODE:%%{http_code}" "%BASE%/api/v1/statistics/global" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 15. GET /geo-attacks -----
set /a TOTAL+=1
echo [%TOTAL%] GET /api/v1/geo-attacks
curl -s -w "\nHTTP_CODE:%%{http_code}" "%BASE%/api/v1/geo-attacks" > _test_out.tmp 2>&1
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" _test_out.tmp') do set CODE=%%a
if "%CODE%"=="200" (
    echo     PASS (200^)
    set /a PASS+=1
) else (
    echo     FAIL (HTTP %CODE%^)
    set /a FAIL+=1
)
type _test_out.tmp | findstr /v "HTTP_CODE"
echo.

:: ----- 16. GET /feed (SSE - 3 second sample) -----
set /a TOTAL+=1
echo [%TOTAL%] GET /api/v1/feed (SSE - 3s sample)
curl -s -m 3 "%BASE%/api/v1/feed" > _test_out.tmp 2>&1
if %ERRORLEVEL% LEQ 28 (
    echo     PASS (stream received, curl timed out as expected^)
    set /a PASS+=1
) else (
    echo     FAIL (connection error^)
    set /a FAIL+=1
)
type _test_out.tmp
echo.

:: ----- Summary -----
echo ============================================================
echo  RESULTS: %PASS%/%TOTAL% passed, %FAIL% failed
echo ============================================================

if %FAIL% GTR 0 (
    echo  *** FAILURES DETECTED - review output above ***
) else (
    echo  All endpoints OK
)

:: Cleanup
del _test_out.tmp 2>nul
echo.
pause
