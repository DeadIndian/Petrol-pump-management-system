"""Build account-independent view templates from authorized Petrosoft captures.

Only layout, labels and styles enter the source tree. Imported business rows,
station settings and reference screenshots remain in the ignored .petrosoft dir.
Requires beautifulsoup4 and lxml; it does not contact the reference website.
"""
import json
import hashlib
import re
import sys
from pathlib import Path
from urllib.parse import urlparse
sys.path.insert(0,"/tmp/petrosoft-parser")
from bs4 import BeautifulSoup, Comment
PARSER="html5lib"

PROJECT = Path(__file__).resolve().parents[2]
CAPTURES = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/petrosoft-reference")
TEMPLATES = PROJECT / "lib/petrosoft/templates"
PRIVATE = PROJECT / ".petrosoft"
TEMPLATES.mkdir(parents=True, exist_ok=True)
PRIVATE.mkdir(parents=True, exist_ok=True)
ORIGIN = "https://petrosoft.ymtsindia.in"

PATHS = [
    ("Dashboard", "dashboard", "Dashboard", "dashboard"),
    ("BunkMaster", "organization", "Organization Details", "settings"),
    ("UserRole", "roles", "Role Permission", "master"),
    ("my_bunks", "bunks", "My Bunks", "master"),
    ("myprofile/changepwd", "password", "Change Password", "settings"),
    ("SystemSettings", "settings", "System Settings", "settings"),
    ("Backup", "backup", "Backup Data", "settings"),
    ("app/reportus/add", "support", "Report Us", "transaction"),
    ("CreateUsres", "users", "Bunk Users", "master"),
    ("LiquidAdd", "fuel-products", "Fuel Products", "master"),
    ("AddLubprods", "lubricants", "Lubricants", "master"),
    ("AddCreditParty", "customers", "Credit Customer", "master"),
    ("AddEmplys", "employees", "Employees", "master"),
    ("AddExptype", "expense-types", "Expense Types", "master"),
    ("addBusinsParty", "business-parties", "Busi. Crd/Debit Party", "master"),
    ("app/vendor/add", "vendors", "Vendor", "master"),
    ("AddSwipeModes", "swipe-machines", "Swipe Machines", "master"),
    ("ExpiryAlerts", "expiry-items", "Expiry Items", "master"),
    ("AddTanks", "tanks", "Tank & Nozzle", "master"),
    ("ConnectPumps", "pump-settings", "Pump Setting", "master"),
    ("AddWorkShift", "duty-shifts", "DutyPay Shift", "master"),
    ("AddBusiShift", "business-shifts", "Business Shift", "master"),
    ("print-master", "print-templates", "Print Templates", "settings"),
    ("Master_Gustcust", "guests", "Guest Entry", "master"),
    ("app/denomination/add", "denominations", "Denominations", "master"),
    ("app/parameters/lists", "parameters", "Parameters Master", "master"),
    ("LqInvoice", "fuel-purchases", "Fuel Purchase", "transaction"),
    ("LubInvoice", "lubricant-purchases", "Lubricant Purchase", "transaction"),
    ("LfrInvoice", "lfr-invoices", "LFR Invoice", "transaction"),
    ("GstInvoice", "other-purchases", "Other-Purchases", "transaction"),
    ("Dayassignings", "day-assignments", "Day Assignings", "transaction"),
    ("DaySalerate", "daily-rates", "Daily Sale Rate", "transaction"),
    ("MeterSale", "meter-sales", "Sale Entry", "transaction"),
    ("LubsSale", "lubricant-sales", "Lubricants", "transaction"),
    ("Swipesales", "swipes", "Swipe", "transaction"),
    ("CreditSaleMulti", "credit-sales", "Credit Sale", "transaction"),
    ("DaySadar", "expenses", "Expenses", "transaction"),
    ("PartyCollection", "recoveries", "Recovery", "transaction"),
    ("empCashRec", "employee-recoveries", "Emp Cash Recovery", "transaction"),
    ("lqDayopen_stock", "opening-stock", "Day Opening Stock", "transaction"),
    ("Daysettlement", "settlements", "Day Settlement", "transaction"),
    ("app/bowser/bowser_sale", "bowser-sales", "Bowser Sale", "transaction"),
    ("BowserLubsle", "bowser-lubricant-sales", "Lubricants", "transaction"),
    ("BowserSwipesales", "bowser-swipes", "Bowser Swipe", "transaction"),
    ("CrediBowsertSale", "bowser-credit-sales", "Bowser Credit Sale", "transaction"),
    ("BowserExpence", "bowser-expenses", "Bowser Expenses", "transaction"),
    ("BowserCollection", "bowser-recoveries", "Bowser Recovery", "transaction"),
    ("app/master/box/sheet", "shift-sheet", "Shift Sheet Entry", "transaction"),
    ("app/credit_report/bill_generation", "statements", "Statement Generation", "transaction"),
    ("Reports", "reports", "Reports", "report"),
    ("TransMovement", "business-transactions", "Busi. Cr/Dr Trxns", "transaction"),
    ("VendorTrns", "vendor-transactions", "Vendor Transaction", "transaction"),
    ("app/credit/generate_bill", "sale-invoices", "Generate SaleInvoice", "transaction"),
    ("CreditInvoice", "credit-invoices", "Credit Invoices", "transaction"),
    ("app/credit/prev_invoices", "generated-invoices", "Generated Invoices", "transaction"),
    ("app/einvoice/prev_eway", "eway-bills", "Generated Eway Bills", "transaction"),
    ("CreidtPartyLImit", "credit-limits", "Credit Limit Reports", "report"),
    ("stockReport", "stock", "Stock Report", "report"),
    ("app/product/lub_lossadd", "lubricant-loss", "Lub Loss", "transaction"),
    ("Lubstock", "lubricant-stock", "Lubs Stock", "report"),
    ("app/product/minimu_stock_alert", "minimum-stock", "Minimum stock", "report"),
    ("app/product/lq_minimu_stock", "fuel-minimum-stock", "Lq Minimum stock", "report"),
    ("app/interest/add", "interest", "Interest Trans", "transaction"),
    ("app/master/module_entries", "sheet-records", "Sheet Records", "report"),
    ("DayBusi_flow", "cash-flow", "Day cash report", "report"),
    ("T-Tsaleflow", "tanker-sales", "Tanker sale", "transaction"),
    ("GuestSale", "guest-sales", "Guest Sales", "transaction"),
    ("AttendanceEmp", "attendance", "Attendance", "transaction"),
    ("payroll", "payroll", "Pay Roll", "transaction"),
    ("Sales_Officer", "sales-officer", "Sales Officer", "transaction"),
    ("Crd_Req", "credit-requests", "Credit Requests", "transaction"),
    ("app/expiryItems/ExpiryList", "expiry-list", "Expiry Items", "report"),
    ("app/expiryItems/Brs_statement", "brs", "BRS", "transaction"),
    ("app/credit_report/brs_generation", "brs-generation", "Generate BRS", "transaction"),
    ("app/expiryItems/Vrs_statement", "vrs", "VRS", "transaction"),
    ("app/credit_report/vrs_generation", "vrs-generation", "Generate VRS", "transaction"),
    ("app/guestcust/hand_add", "handling-loss", "Handling Loss", "transaction"),
    ("app/master/audit_report", "audit", "Audit Report", "report"),
    ("feedback", "feedback", "Feedback", "transaction"),
    ("app/loyalty_programme/dashboard", "loyalty-dashboard", "Dashboard", "dashboard"),
    ("app/loyalty_programme/detail_points", "loyalty-tiers", "Tiers", "master"),
    ("app/loyalty_programme/point_details", "loyalty-points", "Points", "master"),
    ("app/loyalty_programme/master_gifts", "gifts", "Gifts", "master"),
    ("app/loyalty_programme/gift_purchase", "gift-purchases", "Gift Purchase", "transaction"),
    ("app/loyalty_programme/gift_sale", "gift-sales", "Gift Sale", "transaction"),
]

FIELD_COLUMNS = {
 "fuel-products": [None,"liqpro_name","short_name","vat","tcs","gst","lfr","min_quantity"],
 "lubricants": [None,"pro_name","gst","hsn_code","mrp_rate","sale_rate","min_quantity"],
 "customers": [None,None,None,"join_dt","org_name","cust_gstno","phone_no","cust_category","disc_offer","open_bal","org_advance","credit_limit","eml","org_address","cust_name"],
 "employees": [None,None,None,"join_dt","emp_name","emp_no","emp_ph_no","designation","salary_type","salary"],
 "vendors": [None,"ven_comp","ven_phno","gst_no","vend_type","open_bal","ven_eml","vend_details"],
 "tanks": [None,"tank_name","tank_cap","pro_name"],
 "swipe-machines": [None,"swipe_name","attach_type"],
 "expense-types": [None,"exp_name","effectemp","effect_type","effect_income"],
 "duty-shifts": [None,"shift_name","from_time","to_time","duties"],
 "business-shifts": [None,"shift_name","from_time","to_time"],
 "guests": [None,"cust_name","mobile_no","vehicle_no"],
 "denominations": [None,"denomination","denom_value"],
 "gifts": [None,"gift_name","points","stock"],
}

def clean_text(element):
    return element.get_text(" ", strip=True).replace("\xa0", " ")

def table_appearance(document, table_id, headings):
    table = document.find('table', id=table_id)
    if not table:
        table = next((candidate for candidate in document.select('table') if [clean_text(node) for node in candidate.select('thead th')] == headings), None)
    wrapper = table.find_parent(class_='dataTables_wrapper') if table else None
    enhanced = bool(wrapper or table and any(name in ['display', 'dataTable', 'datatable-basic'] for name in table.get('class', [])))
    formats = {'Copy': 'copy', 'CSV': 'csv', 'PDF': 'pdf', 'Print': 'print', 'Excel': 'xlsx'}
    exports = [formats[clean_text(node)] for node in wrapper.select('.dt-buttons > *') if clean_text(node) in formats] if wrapper else ['csv', 'pdf'] if enhanced else []
    lengths = [int(option['value']) for option in wrapper.select('.dataTables_length select option') if re.fullmatch(r'-?\d+', option.get('value', ''))] if wrapper else []
    scroll = wrapper.select_one('.dataTables_scrollBody') if wrapper else None
    height = re.search(r'(?:^|;)\s*(?:max-)?height\s*:\s*(\d+(?:\.\d+)?px)', scroll.get('style', '')) if scroll else None
    return {'exports': exports, 'lengths': lengths or [-1, 10, 50, 100, 500], 'scrollY': height.group(1) if height else '250px', 'enhanced': enhanced}

def relation(name, labels):
    name = name.lower().replace("[]", "")
    if re.search(r"(organiz|credit_org|rec_organiz|org_input|crd_cust|cust_id)", name): return "customers"
    if re.search(r"(employee|emp_id|credsale_emp|rec_emp|swipesale_emp|employees|pump_emp)",name): return "employees"
    if re.search(r"(vendor|ven_comp)",name) and name != "vend_type": return "vendors"
    if re.search(r"(tank_no|tank_id|stock_tank|^tank$)",name): return "tanks"
    if re.search(r"(nozzle|nozzel|^noz$|^nozz$)",name): return "nozzles"
    if re.search(r"(swipe_name|swipe_bank|swp_name)",name): return "swipe-machines"
    if re.search(r"(exp_type|exptype|expense_type)",name): return "expense-types"
    if re.search(r"(lubs|lub_name|pro_name2|stk_prod)",name): return "lubricants"
    if re.search(r"(prod|selct_prod|liquid)",name) and not re.search(r"(type|group)",name): return "fuel-products"
    if re.search(r"(gift_id|gift_name)",name): return "gifts"
    if re.search(r"(busicrd|crd_name|party_name)",name): return "business-parties"
    if "mobile_no" in name and any("@" not in v and len(v)>8 for v in labels): return "guests"
    return None

def local_relation(module, name, labels):
    key=name.lower().replace('[]','')
    if key in ['partytype','topartytype','partytyp','crd_name','creditor_name','trans_party','partyname_field','received','handed','expbanktype_field','payment_bank','banktype_field','attach_bank','bank']: return 'business-parties'
    if key in ['vendor','vend','vend_name','vendor_name','vendor_id','paidvend_name','paidvend_name_in','expvendtype_field','attach_vendor']: return 'vendors'
    if key in ['prodsale_emp','sale_emp','noz_emp','employee','employeename','emp_name','colemp_id','pay_emply','emp_idi','day_emp','emp_type']: return 'employees'
    if key in ['org_name','organn','organnn','organnq','organizq','search_org','org_id','credit_org','org_input']: return 'customers'
    if key in ['guest_cust','guest_id','mobile_no','ref']: return 'guests'
    if key=='role': return 'roles'
    if key in ['gifts','gift','gift_name'] or (module=='gift-purchases' and key=='gname'): return 'gifts'
    if key in ['cat_name','cat_id']: return 'expiry-categories'
    if key in ['pur_proname1','proname','lub_name1','lub_prod','stk_prod']: return 'lubricants'
    if key in ['prod_name','prodc','liquid_prod','req_prod','pro_name'] and module not in ['lubricant-purchases','lubricant-sales']: return 'fuel-products'
    if key in ['tank','tank_no','stock_tank']: return 'tanks'
    if key in ['bowser','bowsr_list','bowsr','recovery_crd','bowser_crd','bowser_exp','bowser_lub','bowser_swipe']: return 'bowsers'
    if key in ['tier_name']: return 'loyalty-tiers' if module!='loyalty-tiers' else None
    if key in ['shift','emp_shift','selct_shift']: return 'business-shifts' if key!='emp_shift' else 'duty-shifts'
    if key in ['swipe_name','swpp_bank','swp_name','swipe_bank']: return 'swipe-machines'
    guessed=relation(name,labels)
    if guessed: return guessed
    # Match populated choices to the private native masters, then discard choices
    # from the tracked template. The runtime obtains them from this station's DB.
    scores=[]
    for relation_id, master_names in MASTER_NAMES.items():
        score=sum(1 for label in labels if re.sub(r'\s+',' ',label.strip()).casefold() in master_names)
        if score: scores.append((score,relation_id))
    return max(scores)[1] if scores else None

def label_for(field, form):
    fid=field.get("id")
    label=form.find("label",attrs={"for":fid}) if fid else None
    if not label:
        parent=field.parent
        for _ in range(3):
            if not parent or parent==form: break
            label=parent.find("label")
            if label: break
            parent=parent.parent
    return clean_text(label) if label else field.get("placeholder") or field.get("name") or ""

def source_id(row, fallback):
    for a in row.select("a[href]"):
        href=a.get("href", "")
        if re.search(r"/(edit|.*InAct|.*edit|addNozzle|view|incent)/",href,re.I):
            tail=href.split("/")
            for i, value in enumerate(tail):
                if re.search(r"edit|InAct|addNozzle|view|incent",value,re.I) and i+1<len(tail) and tail[i+1].isdigit(): return tail[i+1]
    for el in row.select("[data-target]"):
        match=re.search(r"(\d+)$",el.get("data-target", ""))
        if match: return match.group(1)
    return str(fallback)

def rewrite_url(value):
    if not isinstance(value,str): return value
    value=value.replace(ORIGIN+"/", "/petrosoft/")
    value=value.replace("/petrosoft/assets/","/petrosoft-assets/assets/")
    value=value.replace("/petrosoft/public/","/petrosoft-assets/public/")
    value=value.replace("/petrosoft//assets/","/petrosoft-assets/assets/")
    value=re.sub(r"https://(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com)/[^\s'\"()<>]+",lambda m: "/petrosoft-assets/external/"+hashlib.sha256(m.group(0).encode()).hexdigest()[:24]+(".css" if "fonts.googleapis.com" in m.group(0) else Path(urlparse(m.group(0)).path).suffix or ".asset"),value)
    return value

assets=json.loads(Path("/tmp/petrosoft-assets.json").read_text()) if Path("/tmp/petrosoft-assets.json").exists() else {}
native=json.loads((PRIVATE/'native.json').read_text()).get('tables',{}) if (PRIVATE/'native.json').exists() else {}
MASTER_NAMES={}
for key,table,field in [('customers','k_cust','org_name'),('employees','k_emp','emp_name'),('vendors','k_vendors','vend_compname'),('business-parties','k_businesscreditors','crd_name'),('fuel-products','k_lqproducts','prod_name'),('lubricants','k_product','product_name'),('tanks','k_tank','tank_name'),('nozzles','k_nozzel','noz_name'),('swipe-machines','k_swipebanks','bank_name'),('roles','user_roles','role_name'),('guests','g_cust','g_cust_name')]:
    MASTER_NAMES[key]={re.sub(r'\s+',' ',str(row.get(field,'')).strip()).casefold() for row in native.get(table,[])}
catalog=[]
initial={"settings":{},"records":[],"datasets":{},"openingBalances":{}}
for route,module,title,kind in PATHS:
    name=route.replace("/","__")
    path=CAPTURES/(name+".source.html")
    if not path.exists(): raise SystemExit("Reference capture missing: "+route)
    soup=BeautifulSoup(path.read_text(),PARSER)
    hydrated=soup
    hydrated_path=CAPTURES/(name+".html")
    if hydrated_path.exists():
        hydrated=BeautifulSoup(hydrated_path.read_text(),PARSER)
        for table in soup.select(".content-wrapper table[id]"):
            actual=hydrated.find("table",id=table["id"])
            if actual and actual.tbody and table.tbody:
                table.tbody.replace_with(BeautifulSoup("<table>"+str(actual.tbody)+"</table>",PARSER).tbody)
    content=soup.select_one(".content-wrapper") or soup.body
    meta={"id":module,"path":route,"title":title,"kind":kind,"forms":[],"tables":[]}
    # Take the original table headings, and import data separately from templates.
    for ti,table in enumerate(content.select("table")):
        if table.find_parent(class_="modal"): continue
        headings=[clean_text(e) for e in table.select("thead th")]
        special=module in ['roles','parameters','statements'] and bool(headings) and headings[0] not in ['Shortcut','Feature']
        if not headings or not (special or any(re.search(r"^s(?:l)?[. ]*no\b", h,re.I) for h in headings[:2])): continue
        table_id=table.get("id") or "ps-table-"+str(ti)
        table["id"]=table_id
        table["data-ps-table"]=module
        columns=FIELD_COLUMNS.get(module,[])
        if module=='business-parties':columns=[None,None,None,'join_dt','p_type','open_bal','crd_name','mobile','email','desc']
        if module=='roles':columns=['role_name','role_description',None]
        if module=='parameters':columns=['cCode','cValue','cDesc',None]
        if module=="employees":columns=[None,"emp_name","emp_no","emp_ph_no","salary","emp_limit","aadhaar_no","designation","emp_addrs","emp_desc"]
        if module=="pump-settings":columns=[None,"pump_name","noz","tank_no"]
        if module=="gifts":columns=[None,"join_dt","emp_name","emp_no","emp_desc"]
        if module=="loyalty-tiers":columns=[None,"tier_name","points_rate"]
        if module=="loyalty-points":columns=[None,"tier_name","prod_id","points_rate"]
        meta["tables"].append({"id":table_id,"headers":headings,"columns":columns,**table_appearance(hydrated,table_id,headings)})
        if table.tbody:
            for ri,row in enumerate(table.tbody.find_all("tr",recursive=False)):
                cells=row.find_all(["td","th"],recursive=False)
                if len(cells)<3 or len(cells)!=len(headings): continue
                external_id=source_id(row,ri+1)
                text=[clean_text(e) for e in cells]
                fields={}
                for ci,key in enumerate(columns):
                    if key and ci<len(text): fields[key]=text[ci]
                # An imported row remains recognizable without retaining unsafe HTML.
                fields["__cells"]=text
                fields["__headers"]=headings
                fields["__imported"]=True
                if module=="tanks":
                    m=re.search(r"Id\s*:\s*(\w+)",fields.get("tank_name",""))
                    fields["tank_no"]=m.group(1) if m else "T"+external_id
                    fields["tank_name"]=re.sub(r"\s*Id\s*:\s*\w+","",fields.get("tank_name",""))
                if module=="customers":
                    fields["phone_no"]=re.search(r"Phone:\s*(\d*)",fields.get("phone_no","")).group(1) if "Phone:" in fields.get("phone_no","") else fields.get("phone_no","")
                    # The legacy UI displays customer passwords; never import them.
                    if len(fields["__cells"])>18: fields["__cells"][18]="User Name : Password :"
                if module=="users":
                    for ci,h in enumerate(headings):
                        if re.search(r"password|pwd",h,re.I):fields["__cells"][ci]="••••••••"
                initial["records"].append({"module":module,"externalId":external_id,"fields":fields,"status":"inactive" if any(re.search(r"inactiv|inactivat",x,re.I) for x in text) else "active"})
            table.tbody.clear()
    # Remove per-record dialogs. The runtime opens the same form with local data.
    for modal in list(content.select(".modal")):
        mid=modal.get("id","")
        if re.search(r"\d$",mid) and modal.find("form"): modal.decompose()
        elif re.search(r"(image|uploaded|img|pic)",mid,re.I) and re.search(r"\d",mid): modal.decompose()
    for fi,form in enumerate(soup.select("form")):
        action=form.get("action","")
        if not action.startswith(ORIGIN): continue
        action=urlparse(action).path.lstrip("/")
        schema={"index":fi,"action":action,"fields":[],"title":title}
        headings=form.find_all(["h1","h2","h3","h4","h5","h6"])
        if headings:schema["title"]=clean_text(headings[0])
        else:
            previous=form.find_previous(["h3","h4","h5","h6"])
            if previous and previous in content.descendants:schema["title"]=clean_text(previous)
        legend=form.find('legend')
        if not legend and form.find_parent('fieldset'):legend=form.find_parent('fieldset').find('legend')
        if legend:schema['title']=clean_text(legend)
        button_text=" ".join(clean_text(e) or e.get("value","") for e in form.select("button,input[type=submit]"))
        schema["operation"]="report" if kind=="report" and module=="reports" else "filter" if 'Search' in button_text or (kind=='report' and module!='reports') else "save"
        if module!='reports' and re.search(r'/(?:save|\w*save\w*)/?$',action,re.I):schema['operation']='save'
        if module=='generated-invoices' and 'cancel' not in action:schema['operation']='filter'
        if module=='payroll':schema['operation']='filter'
        if re.search(r"upload|bulk_import|import_csv|import_xls",action,re.I):schema["operation"]="import"
        if "updateprofile" in action:schema["operation"]="profile"
        form["data-ps-form"]=str(fi)
        form["data-ps-operation"]=schema["operation"]
        form["action"]="/api/petrosoft/action"
        form["method"]="post"
        seen=set()
        for field in form.select("input[name],select[name],textarea[name]"):
            fname=field.get("name","")
            if fname=="example_length": continue
            label=label_for(field,form)
            opts=[{"value":o.get("value",clean_text(o)),"label":clean_text(o)} for o in field.select("option")]
            rel=local_relation(module,fname,[x["label"] for x in opts]) if field.name=="select" else None
            ftype=field.get("type","select" if field.name=="select" else "textarea" if field.name=="textarea" else "text")
            if fname not in seen:
                schema["fields"].append({"name":fname,"id":field.get("id",""),"label":label,"type":ftype,"required":field.has_attr("required"),"multiple":field.has_attr("multiple"),"relation":rel,"options":[] if rel else opts})
                seen.add(fname)
            field["data-ps-field"]=fname
            if rel:
                field["data-ps-relation"]=rel
                nonempty=next((x['value'] for x in opts if x['value'] not in ['', 'all', 'All', '0']), '')
                if '|' in nonempty:field['data-ps-option-format']='party'
                if rel=='tanks' and nonempty.startswith('T'):field['data-ps-option-value']='tank_no'
                for option in list(field.select('option')):
                    if option.get('value','') not in ['', 'all', 'All'] or len(option.get_text(strip=True))>40:option.decompose()
            if module in ["organization","settings"]:
                if ftype in ["checkbox","radio"]:
                    if field.has_attr("checked"):
                        if fname.endswith('[]'):initial["settings"].setdefault(fname,[]).append(field.get("value","on"))
                        else:initial["settings"][fname]=field.get("value","on")
                elif ftype=="select":
                    selected=field.select_one("option[selected]")
                    if selected:initial["settings"][fname]=selected.get("value",clean_text(selected))
                elif ftype not in ["file","password"]:
                    initial["settings"][fname]=field.get("value",field.get_text() if field.name=="textarea" else "")
            if module=="shift-sheet" and fname.startswith("new_rate["):
                initial.setdefault("rates",{})[re.sub(r"\D","",fname)]=field.get("value","0")
            if ftype=="password":field["value"]=""
            if fname.lower() in ['org_list','products_list','allemplist','crd_list','vend_list','vendlist','explist','swplist','u_name','user_name','username']:field['value']=''
            if fname=="bunk_reference_code":field["value"]="__PS_REFERENCE__"
            if module in ["organization","settings"] and ftype not in ["checkbox","radio","file","select"]:
                field["value"]=""
                if field.name=='textarea':field.string=''
        # Mark the repeated record blocks while retaining their original layout.
        marked=[]
        for field in form.select("[name]"):
            if "[]" not in field.get("name","") or field.get("type")=="hidden":continue
            for parent in field.parents:
                if parent==form:break
                if parent.name not in ["div","tr"]:continue
                array_fields=[e for e in parent.select("[name]") if "[]" in e.get("name","") and e.get("type")!="hidden"]
                if len(array_fields)>=3 and not any(c.startswith("col-") for c in parent.get("class",[])):
                    if parent not in marked and not any(p in marked for p in parent.parents):
                        parent["data-ps-row"]="1"
                        marked.append(parent)
                    break
        meta["forms"].append(schema)
    # Some auxiliary controls sit outside a form in the original's malformed
    # markup. Localize those relationships too, so tenant choices never ship.
    for field in soup.select('select'):
        if field.has_attr('data-ps-relation'):continue
        labels=[clean_text(option) for option in field.select('option')]
        rel=local_relation(module,field.get('name') or field.get('id',''),labels)
        if not rel:continue
        field['data-ps-relation']=rel
        for option in list(field.select('option')):
            if option.get('value','') not in ['', 'all', 'All', '0']:option.decompose()
    if module=='support':
        for field in soup.select('input[name],textarea[name]'):
            setting={'emp_ph_no':'contact','email':'email','emp_name':'company_name'}.get(field.get('name',''))
            if setting:field['data-ps-setting']=setting;field['value']=''
    # Clear credentials outside named forms too: the legacy password page
    # includes a nameless hidden input containing the current password.
    for field in soup.select('input'):
        identity = ' '.join([field.get('id', ''), field.get('name', '')])
        if field.get('type', '').lower() == 'password' or re.search(r'password|passwd|pwd|secret|token', identity, re.I):
            field['value'] = ''
    # Source scripts are reference material. Local controllers implement all writes.
    for script in soup.select("script"):script.decompose()
    for comment in list(soup.find_all(string=lambda value:isinstance(value,Comment))):comment.extract()
    for datalist in soup.select('datalist'):datalist.clear()
    for element in soup.find_all(True):
        for attribute in list(element.attrs):
            if attribute.startswith("on"):
                element["data-ps-"+attribute]=element.get(attribute,"")
                del element[attribute]
        for attribute in ["href","src","action","data-url"]:
            if element.has_attr(attribute):element[attribute]=rewrite_url(element[attribute])
        if element.name=="a" and element.get("href","").startswith("javascript:"):
            element["href"]="#"
        if element.name=="style":element.string=rewrite_url(element.string or "".join(str(child) for child in element.contents))
    for text in list(soup.find_all(string=lambda s:s and "SRI KRISHNA FILLING STATION" in s)):
        text.replace_with(str(text).replace("SRI KRISHNA FILLING STATION","__PS_STATION__"))
    if soup.title:soup.title.string="__PS_STATION__"
    for error in list(soup.find_all(string=lambda s:s and "A PHP Error was encountered" in s)):
        box=error.find_parent("div")
        if box:box.decompose()
    # Local-only libraries retain the native widgets and their original visual skin.
    libraries=[
      "assets/js/jquery/jquery.min.js","assets/js/core/libraries/bootstrap.min.js",
      "assets/js/plugins/ui/moment/moment.min.js","assets/datejs/bootstrap-datetimepicker.min.js",
      "assets/js/plugins/notifications/sweet_alert.min.js","assets/tom_select/tom-select.complete.min.js",
      "assets/select2/js/select2.full.min.js","assets/js/plugins/tables/datatables/datatables.min.js",
      "assets/js/plugins/tables/datatables/extensions/buttons.min.js","assets/js/apexcharts.js",
    ]
    for library in libraries:
        tag=soup.new_tag("script",src="/petrosoft-assets/"+library);soup.body.append(tag)
    for controller in ['runtime.js','widgets.js','tables.js','forms.js','workflows.js','views.js']:
        tag=soup.new_tag("script",src="/petrosoft-assets/"+controller);soup.body.append(tag)
    css=soup.new_tag("link",rel="stylesheet",href="/petrosoft-assets/runtime.css");soup.head.append(css)
    context=soup.new_tag("script",type="application/json",id="ps-context");context.string="__PS_CONTEXT__";soup.body.insert(0,context)
    html=str(soup)
    (TEMPLATES/(module+".html")).write_text(html)
    catalog.append(meta)

# Public two-stage login screens use the exact reference layouts.
for filename,template in [("reference-code.html","station"),("login.html","login")]:
    soup=BeautifulSoup((CAPTURES/filename).read_text(),PARSER)
    for script in soup.select("script"):script.decompose()
    for e in soup.find_all(True):
        for attr in list(e.attrs):
            if attr.startswith('on'):del e[attr]
        for attr in ["src","href","action"]:
            if e.has_attr(attr):e[attr]=rewrite_url(e[attr])
        if e.name=="style":e.string=rewrite_url(e.string or "".join(str(child) for child in e.contents))
    for form in soup.select("form"):form["action"]="/api/petrosoft/auth";form["data-ps-auth"]=template
    for field in soup.select('input[type=password]'):field['value']=''
    for text in list(soup.find_all(string=lambda s:s and "SRI KRISHNA FILLING STATION" in s)):text.replace_with(str(text).replace("SRI KRISHNA FILLING STATION","__PS_STATION__"))
    css=soup.new_tag("link",rel="stylesheet",href="/petrosoft-assets/runtime.css");soup.head.append(css)
    script=soup.new_tag("script",src="/petrosoft-assets/runtime.js");soup.body.append(script)
    context=soup.new_tag("script",type="application/json",id="ps-context");context.string="__PS_CONTEXT__";soup.body.insert(0,context)
    (TEMPLATES/(template+".html")).write_text(str(soup))
    for e in soup.select("link[rel=stylesheet]"):
        url=e.get("href","")
        if url.startswith("/petrosoft-assets/"):assets.setdefault("styles",[]).append(ORIGIN+"/"+url.removeprefix("/petrosoft-assets/"))
    for e in soup.select("img[src]"):
        url=e.get("src","")
        if url.startswith("/petrosoft-assets/"):assets.setdefault("images",[]).append(ORIGIN+"/"+url.removeprefix("/petrosoft-assets/"))

(PROJECT/"lib/petrosoft/catalog.json").write_text(json.dumps(catalog,ensure_ascii=False,separators=(",",":")))
for table,filename,keys in [('pages','pages.json',['page_id','page_module','page_name','page_link']),('future_pages','features.json',['f_id','f_module','f_name','f_link'])]:
    if native.get(table):
        rows=[{key:str(row.get(key,'') or '') for key in keys} for row in native[table]]
        (PROJECT/'lib/petrosoft'/filename).write_text(json.dumps(rows,separators=(',',':')))
(PRIVATE/"import.json").write_text(json.dumps(initial,ensure_ascii=False))
(PRIVATE/"asset-list.json").write_text(json.dumps(assets))
print(json.dumps({"modules":len(catalog),"forms":sum(len(x["forms"]) for x in catalog),"reports":len(next(x for x in catalog if x["id"]=="reports")["forms"]),"importedRows":len(initial["records"]),"templates":str(TEMPLATES)}))
