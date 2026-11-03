#!/usr/bin/env python3
"""Archive authorized Petrosoft exports and read-only views in private storage."""
import argparse
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
import getpass
import hashlib
import io
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlparse
import zipfile

from bs4 import BeautifulSoup
import requests

from native import SECRET, parse_backup


ROOT = Path(__file__).resolve().parents[2]
ORIGIN = "https://petrosoft.ymtsindia.in"
DATE_FROM = {"frm_dt", "from_dt", "purfrm_dt", "swp_frm_dt", "credit_dt", "recov_dt", "dt"}
DATE_TO = {"to_dt", "purto_dt", "swp_to_dt", "dt2"}
DATE_SINGLE = {"rdate", "one_dt", "bowsr_date"}
ALL_LABELS = {"all", "all customers", "all employees", "all products", "all categories", "all tanks", "all banks", "all vendors", "all locations", "all organizations", "all organisations"}
FILTER_NAMES = DATE_FROM | DATE_TO | DATE_SINGLE | {
    "frm_dt", "to_dt", "from_dt", "selct_prod", "organizq", "emp_id", "product",
    "prod_id", "tank", "tank_no", "shift", "swipe_bank", "Vendor", "partytype",
    "user_log", "csrf_test_name",
}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def private_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    data = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    path.write_bytes(data)
    path.chmod(0o600)


def endpoint(path):
    url = urljoin(ORIGIN + "/", path)
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != urlparse(ORIGIN).netloc or parsed.username or parsed.password:
        raise ValueError("Refusing an endpoint outside the authorized source origin")
    return url


def fields_for(form, start, end):
    result = {}
    for control in form.select("input[name],select[name],textarea[name]"):
        name = control["name"]
        kind = control.get("type", "text").lower()
        if kind in {"button", "submit", "file", "password"}:
            continue
        if kind in {"checkbox", "radio"} and not control.has_attr("checked") and name != "all":
            continue
        if control.name == "select":
            enabled = [option for option in control.select("option") if not option.has_attr("disabled")]
            options = [option for option in enabled if option.get("value", "").strip()]
            all_options = [option for option in enabled if option.get_text(" ", strip=True).lower() in ALL_LABELS]
            if all_options:
                chosen = all_options[:1]
            elif control.has_attr("multiple") or name.endswith("[]"):
                chosen = options
            elif not control.has_attr("required") and enabled and not enabled[0].get("value", "").strip():
                chosen = enabled[:1]
            else:
                chosen = [option for option in options if option.has_attr("selected")] or options[:1]
            values = [option.get("value", option.get_text(strip=True)) for option in chosen] or [""]
        else:
            values = [control.get("value", control.get_text() if control.name == "textarea" else "")]
        if name in DATE_FROM:
            values = [start]
        elif name in DATE_TO or name in DATE_SINGLE:
            values = [end]
        result.setdefault(name, []).extend(values)
    return result


def monthly_ranges(start, end):
    cursor, finish = date.fromisoformat(start), date.fromisoformat(end)
    if cursor > finish:
        raise ValueError("Invalid monthly retry range")
    while cursor <= finish:
        last = min(cursor.replace(day=monthrange(cursor.year, cursor.month)[1]), finish)
        yield cursor.isoformat(), last.isoformat()
        if last == finish:
            break
        cursor = last + timedelta(days=1)


def timeout_range(native, report_index, customer_id, start, end):
    dates = []
    if report_index == 17 or report_index == 1 and customer_id:
        dates.extend(str(row.get("credit_date", ""))[:10] for row in native["tables"].get("k_custcredits", [])
                     if report_index == 17 or str(row.get("custorg_id")) == customer_id)
        if report_index == 1:
            dates.extend(str(row.get("date", ""))[:10] for row in native["tables"].get("k_recovery", []) if str(row.get("organization")) == customer_id)
            dates.extend(str(row.get("op_date", ""))[:10] for row in native["tables"].get("k_cust", []) if str(row.get("cust_id")) == customer_id)
    dates = [value for value in dates if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) and start <= value <= end]
    return {"from": min(dates) if dates else start, "to": end}


def table_data(soup):
    output = []
    for index, table in enumerate(soup.select("table")):
        headers = [node.get_text(" ", strip=True) for node in table.select("thead th")]
        body = table.find("tbody")
        rows = body.find_all("tr", recursive=False) if body else table.find_all("tr", recursive=False)
        safe_columns = [i for i, heading in enumerate(headers) if not SECRET.search(heading)]
        records = []
        for row in rows:
            cells = row.find_all(["td", "th"], recursive=False)
            if not cells:
                continue
            if headers:
                cells = [cells[i] for i in safe_columns if i < len(cells)]
            records.append([cell.get_text(" ", strip=True) for cell in cells])
        if records or headers:
            output.append({"id": table.get("id", str(index)), "headers": [headers[i] for i in safe_columns], "rows": records})
    return output


class Source:
    def __init__(self, session_path, delay):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "Petrosoft authorized read-only data migration"})
        self.delay = delay
        self.session_path = session_path
        self.reference_code = None
        self.allowed_posts = {"/app/backup/backup_database"} | {
            urlparse(endpoint(report["action"])).path.rstrip("/")
            for report in json.loads((ROOT / "lib/petrosoft/reports.json").read_text())
        }
        if session_path.is_file():
            state = json.loads(session_path.read_text())
            self.reference_code = state.get("referenceCode")
            for cookie in state.get("cookies", []):
                if cookie.get("domain", "").lstrip(".") != urlparse(ORIGIN).hostname:
                    continue
                self.session.cookies.set(cookie["name"], cookie["value"], domain=cookie["domain"], path=cookie.get("path", "/"))

    def require_station(self, code):
        if self.reference_code != code:
            raise PermissionError("The source session belongs to another or unverified station; use --login to select the authorized station")

    def fetch(self, path, fields=None, allow_error=False):
        url = endpoint(path)
        if fields is not None and urlparse(url).path.rstrip("/") not in self.allowed_posts:
            raise PermissionError("Refusing a POST outside the verified read-only export and filter routes")
        time.sleep(self.delay)
        response = self.session.request("GET" if fields is None else "POST", url, data=fields, timeout=(10, 45), allow_redirects=False)
        for _ in range(5):
            if response.status_code not in {301, 302, 303, 307, 308}:
                break
            destination = endpoint(urljoin(response.url, response.headers.get("Location", "")))
            if urlparse(destination).path.lower() in {"/reffcode", "/login", "/general/login"}:
                raise PermissionError("The original-site session expired; log in again")
            response = self.session.get(destination, timeout=(10, 45), allow_redirects=False)
        if urlparse(response.url).path.lower() in {"/reffcode", "/login"} or b'name="reff_code"' in response.content[:20000]:
            raise PermissionError("The original-site session expired; log in again")
        if not allow_error:
            response.raise_for_status()
        return response

    def login(self, code, username):
        password = os.environ.get("PETROSOFT_SOURCE_PASSWORD") or getpass.getpass("Original-site password: ")
        response = self.session.get(ORIGIN + "/", timeout=(10, 25))
        soup = BeautifulSoup(response.text, "html.parser")
        form = next((item for item in soup.select("form") if item.select_one('input[name="reff_code"]')), None)
        if form is None:
            raise ValueError("The source station-code form changed")
        response = self.session.post(endpoint(urljoin(response.url, form.get("action", ""))), data={"reff_code": code}, timeout=(10, 25), allow_redirects=False)
        if response.is_redirect:
            response = self.session.get(endpoint(urljoin(response.url, response.headers["Location"])), timeout=(10, 25), allow_redirects=False)
        soup = BeautifulSoup(response.text, "html.parser")
        form = next((item for item in soup.select("form") if item.select_one('input[type="password"]')), None)
        if form is None:
            raise ValueError("The source login form changed")
        controls = form.select("input[name]")
        user = next((item for item in controls if item.get("type", "text").lower() in {"text", "email"}), None)
        pwd = form.select_one('input[type="password"]')
        if user is None:
            raise ValueError("The source username field changed")
        fields = {item["name"]: item.get("value", "") for item in controls}
        fields[user["name"]], fields[pwd["name"]] = username, password
        self.session.post(endpoint(urljoin(response.url, form.get("action", ""))), data=fields, timeout=(10, 25), allow_redirects=False)
        if b"app/backup/backup_database" not in self.fetch("/Backup").content:
            raise PermissionError("The source did not accept the supplied login")
        self.reference_code = code
        private_write(self.session_path, {"referenceCode": code, "cookies": [{"name": c.name, "value": c.value, "domain": c.domain, "path": c.path, "expires": c.expires or -1, "secure": c.secure, "httpOnly": True, "sameSite": "Lax"} for c in self.session.cookies], "origins": []})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", default=str(ROOT / ".petrosoft/source-session.json"))
    parser.add_argument("--out")
    parser.add_argument("--from", dest="start", default="2000-01-01")
    parser.add_argument("--to", dest="end", default=date.today().isoformat())
    parser.add_argument("--delay", type=float, default=0.35)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--backup-only", action="store_true")
    mode.add_argument("--reports-only", action="store_true")
    mode.add_argument("--retry-timeouts", action="store_true", help="Retry only timed-out date-range reports in monthly sections")
    parser.add_argument("--refresh-reports", action="store_true")
    parser.add_argument("--login", action="store_true")
    parser.add_argument("--code")
    parser.add_argument("--user", default="admin")
    args = parser.parse_args()
    date.fromisoformat(args.start), date.fromisoformat(args.end)
    if args.start > args.end or args.delay < 0:
        raise ValueError("Invalid date range or request delay")
    setup_path = ROOT / ".petrosoft/setup.json"
    setup = json.loads(setup_path.read_text()) if setup_path.is_file() else {}
    code = args.code or setup.get("referenceCode")
    if not code:
        raise ValueError("Supply the authorized station code with --code")
    out = Path(args.out or ROOT / (".petrosoft/source/" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))).resolve()
    if out != ROOT / ".petrosoft" and ROOT / ".petrosoft" not in out.parents:
        raise ValueError("Source records must remain inside the ignored .petrosoft directory")
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    source = Source(Path(args.session), args.delay)
    if args.login:
        source.login(code, args.user)
    source.require_station(code)
    if b"app/backup/backup_database" not in source.fetch("/Backup").content:
        raise PermissionError("An authenticated source session is required")
    manifest_path = out / "manifest.json"
    if args.retry_timeouts and not manifest_path.is_file():
        raise ValueError("Monthly timeout retries require an existing snapshot supplied with --out")
    manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {
        "format": "petrosoft-source-archive-v1", "origin": ORIGIN, "referenceCode": code,
        "capturedAt": datetime.now(timezone.utc).isoformat(), "range": {"from": args.start, "to": args.end}, "captures": [],
    }
    if manifest["referenceCode"] != code or manifest["range"] != {"from": args.start, "to": args.end}:
        raise ValueError("The resume directory belongs to another station or date range")
    if not (out / "native.json").is_file():
        response = source.fetch("/app/backup/backup_database", {})
        if not zipfile.is_zipfile(io.BytesIO(response.content)):
            raise ValueError("The source backup was not its expected SQL archive")
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            entries = [item for item in archive.infolist() if item.filename.lower().endswith(".sql") and not item.is_dir()]
            if len(entries) != 1 or entries[0].file_size > 250_000_000:
                raise ValueError("Unexpected source archive structure or size")
            sql = archive.read(entries[0])
        private_write(out / "backup.bin", response.content)
        private_write(out / "backup.sql", sql)
        native = parse_backup(out / "backup.sql")
        private_write(out / "native.json", native)
        manifest["backup"] = {"status": response.status_code, "sourceSha256": native["sourceSha256"], "tablesHash": digest(native["tables"]), "insertRows": native["insertRows"], "retainedRows": sum(len(rows) for rows in native["tables"].values()), "tables": len(native["tables"])}
        private_write(manifest_path, manifest)
    print(json.dumps({"backup": manifest["backup"], "out": str(out.relative_to(ROOT))}), flush=True)
    if args.backup_only:
        return
    finished = {capture["key"] for capture in manifest["captures"] if capture.get("recoveredBy") or capture.get("status") == "saved" and not capture.get("sourceError")}

    def capture(key, path, fields=None):
        if key in finished:
            return
        try:
            response = source.fetch(path, fields, allow_error=True)
            mime = response.headers.get("Content-Type", "")
            html = "html" in mime or response.content.lstrip().startswith(b"<!DOCTYPE")
            result = {"key": key, "path": urlparse(endpoint(path)).path, "status": "saved", "httpStatus": response.status_code, "type": mime, "bytes": len(response.content), "capturedAt": datetime.now(timezone.utc).isoformat(), "responseSha256": hashlib.sha256(response.content).hexdigest()}
            if fields is not None:
                result["requestHash"] = digest(fields)
            if html:
                soup = BeautifulSoup(response.content, "html.parser")
                result["sourceError"] = response.status_code >= 400 or bool(re.search(r"A PHP Error was encountered|Fatal error|database error", soup.get_text(" ")[:6000], re.I))
                tables = table_data(soup)
                private_write(out / (key + ".json"), {"tables": tables})
                result["dataFile"] = key + ".json"
                result["tableRows"] = sum(len(table["rows"]) for table in tables)
            else:
                private_write(out / (key + ".bin"), response.content)
                result["dataFile"] = key + ".bin"
                result["sourceError"] = response.status_code >= 400
            result["dataSha256"] = hashlib.sha256((out / result["dataFile"]).read_bytes()).hexdigest()
            manifest["captures"] = [item for item in manifest["captures"] if item["key"] != key] + [result]
            private_write(manifest_path, manifest)
            print(json.dumps({"capture": key, "status": "source-error" if result.get("sourceError") else "saved", "bytes": result["bytes"]}), flush=True)
            return soup if html else None
        except PermissionError:
            raise
        except (requests.RequestException, ValueError) as error:
            result = {"key": key, "path": urlparse(endpoint(path)).path, "status": "failed", "errorType": type(error).__name__}
            manifest["captures"] = [item for item in manifest["captures"] if item["key"] != key] + [result]
            private_write(manifest_path, manifest)
            print(json.dumps({"capture": key, "status": "failed", "errorType": type(error).__name__}), flush=True)

    pages = json.loads((ROOT / "lib/petrosoft/catalog.json").read_text())
    reports = json.loads((ROOT / "lib/petrosoft/reports.json").read_text())
    allowed_reports = {urlparse(endpoint(report["action"])).path.rstrip("/") for report in reports}

    def complete():
        for item in manifest["captures"]:
            if item.get("dataFile"):
                item["dataSha256"] = hashlib.sha256((out / item["dataFile"]).read_bytes()).hexdigest()
        manifest["completedAt"] = datetime.now(timezone.utc).isoformat()
        manifest["snapshotHash"] = digest({"backup": manifest["backup"]["tablesHash"], "captures": manifest["captures"]})
        private_write(manifest_path, manifest)
        print(json.dumps({"completed": len(manifest["captures"]), "failed": sum(item["status"] == "failed" for item in manifest["captures"]), "recoveredTimeouts": sum(bool(item.get("recoveredBy")) for item in manifest["captures"]), "sourceErrors": sum(bool(item.get("sourceError")) for item in manifest["captures"]), "out": str(out.relative_to(ROOT))}), flush=True)

    if args.retry_timeouts:
        pending = [(item, re.fullmatch(r"report-(\d+)(?:-(customer|employee)-(\d+))?", item["key"]))
                   for item in manifest["captures"] if item["status"] == "failed" and item.get("errorType") == "ReadTimeout" and not item.get("recoveredBy")]
        pending = [(item, match) for item, match in pending if match]
        if not pending:
            complete()
            return
        page = next(page for page in pages if page["id"] == "reports")
        soup = BeautifulSoup(source.fetch(page["path"]).content, "html.parser")
        forms = {urlparse(endpoint(urljoin(endpoint(page["path"]), form["action"]))).path.rstrip("/"): form for form in soup.select("form[action]")}
        native = json.loads((out / "native.json").read_text())
        retry_range = manifest.get("reportRange", manifest["range"])
        for parent, match in pending:
            report = next((report for report in reports if report["index"] == int(match[1])), None)
            path = urlparse(endpoint(report["action"])).path.rstrip("/") if report else None
            form = forms.get(path)
            names = {control["name"] for control in form.select("input[name],select[name]")} if form else set()
            if not form or not names & DATE_FROM or not names & DATE_TO:
                parent["timeoutRecovery"] = {"reason": "The source does not expose a date-range form for monthly retries"}
                continue
            scoped_range = timeout_range(native, report["index"], match[3] if match[2] == "customer" else None, retry_range["from"], retry_range["to"])
            chunks = []
            for start, end in monthly_ranges(scoped_range["from"], scoped_range["to"]):
                key = parent["key"] + "-month-" + start[:7].replace("-", "")
                fields = fields_for(form, start, end)
                if match[2] == "customer":
                    customer = next(row for row in native["tables"].get("k_cust", []) if str(row["cust_id"]) == match[3])
                    fields["credit_org"] = [match[3]]
                    if customer.get("category"):
                        fields["credit_category"] = [str(customer["category"])]
                elif match[2] == "employee":
                    fields["emp_id"] = [match[3]]
                previous = next((item for item in manifest["captures"] if item["key"] == key), None)
                if not previous or previous["status"] != "saved":
                    capture(key, path, fields)
                chunk = next(item for item in manifest["captures"] if item["key"] == key)
                chunk["range"] = {"from": start, "to": end}
                chunks.append(chunk)
                private_write(manifest_path, manifest)
            parent["timeoutRecovery"] = {"requestedRange": retry_range, "range": scoped_range, "chunks": [item["key"] for item in chunks]}
            if all(item["status"] == "saved" and not item.get("sourceError") for item in chunks):
                parent["recoveredBy"] = [item["key"] for item in chunks]
            private_write(manifest_path, manifest)
        complete()
        return

    report_forms = []
    for page in pages:
        if args.reports_only and page["id"] != "reports":
            continue
        soup = capture("page-" + page["id"], page["path"])
        if soup is None:
            result = next((item for item in manifest["captures"] if item["key"] == "page-" + page["id"]), None)
            if result is None or result["status"] != "saved":
                continue
            soup = BeautifulSoup(source.fetch(page["path"]).content, "html.parser")
        for form in soup.select("form[action]"):
            path = urlparse(endpoint(urljoin(endpoint(page["path"]), form["action"]))).path.rstrip("/")
            names = {control["name"] for control in form.select("input[name],select[name],textarea[name]") if control["name"]}
            buttons = " ".join(button.get_text(" ", strip=True) for button in form.select("button"))
            if "Search" in buttons and names <= FILTER_NAMES and names & DATE_FROM and names & DATE_TO:
                source.allowed_posts.add(path)
                capture("history-" + page["id"], path, fields_for(form, args.start, args.end))
            if page["id"] == "reports" and path in allowed_reports:
                report_forms.append((path, form))
    native = json.loads((out / "native.json").read_text())
    historical_dates = []
    for table, column in {"k_custcredits": "credit_date", "k_product_details": "k_prduct_date", "k_lqsale_nozpump": "sale_pdate", "k_purchase": "pur_date", "k_recovery": "date", "k_expenses_list": "expses_dt", "k_vendortrans": "trans_dt"}.items():
        historical_dates.extend(str(row[column])[:10] for row in native["tables"].get(table, []) if row.get(column) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(row[column])[:10]) and args.start <= str(row[column])[:10] <= args.end)
    report_start = min(historical_dates) if historical_dates else args.start
    manifest["reportRange"] = {"from": report_start, "to": args.end}
    manifest["unavailableReports"] = []
    manifest.pop("completedAt", None)
    private_write(manifest_path, manifest)
    for report in reports:
        path = urlparse(endpoint(report["action"])).path.rstrip("/")
        form = next((form for action, form in report_forms if action == path), None)
        if form is None:
            manifest["unavailableReports"].append({"index": report["index"], "reason": "Not exposed as a report form by the original page"})
            continue
        key = "report-" + str(report["index"])
        if args.refresh_reports:
            finished.discard(key)
        fields = fields_for(form, report_start, args.end)
        if fields.get("credit_org") and "credit_category" in fields:
            customer = next((row for row in native["tables"].get("k_cust", []) if str(row["cust_id"]) == fields["credit_org"][0]), None)
            if customer and customer.get("category"):
                fields["credit_category"] = [str(customer["category"])]
        capture(key, path, fields)
        if report["index"] == 1:
            for customer in native["tables"].get("k_cust", []):
                customer_key = key + "-customer-" + str(customer["cust_id"])
                if args.refresh_reports:
                    finished.discard(customer_key)
                customer_fields = dict(fields)
                customer_fields["credit_org"] = [str(customer["cust_id"])]
                if customer.get("category"):
                    customer_fields["credit_category"] = [str(customer["category"])]
                capture(customer_key, path, customer_fields)
        if report["index"] == 26:
            for employee in native["tables"].get("k_emp", []):
                employee_key = key + "-employee-" + str(employee["emp_id"])
                if args.refresh_reports:
                    finished.discard(employee_key)
                employee_fields = dict(fields)
                employee_fields["emp_id"] = [str(employee["emp_id"])]
                capture(employee_key, path, employee_fields)
    complete()


if __name__ == "__main__":
    try:
        main()
    except (PermissionError, requests.RequestException, ValueError, OSError) as error:
        print(json.dumps({"error": str(error).split("Call log:")[0] if not isinstance(error, requests.RequestException) else type(error).__name__}), flush=True)
        raise SystemExit(1)
