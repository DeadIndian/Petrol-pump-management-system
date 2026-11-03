"""Prepare reusable original form fragments with all account values removed."""
import json
from pathlib import Path
import re
import sys
sys.path.insert(0, '/tmp/petrosoft-parser')
from bs4 import BeautifulSoup, Comment

project = Path(__file__).resolve().parents[2]
destination = project / 'public/petrosoft-assets/fragments'
destination.mkdir(parents=True, exist_ok=True)
private = project / '.petrosoft'
native=json.loads((private/'native.json').read_text()).get('tables',{}) if (private/'native.json').exists() else {}
private_names=set()
for table,key in [('k_cust','org_name'),('k_cust','cust_name'),('k_emp','emp_name'),('k_vendors','vend_compname'),('k_businesscreditors','crd_name')]:
    private_names.update(str(row.get(key,'')).strip() for row in native.get(table,[]) if len(str(row.get(key,'')).strip())>3)
relations={'employee':'employees','emp_id':'employees','emp_shift':'duty-shifts','shift':'business-shifts','attach_bank':'business-parties','attach_vendor':'vendors','pd_prod_id':'fuel-products','prod_id':'fuel-products','credit_org':'customers'}

def sanitize(soup):
    for node in list(soup.select('script')): node.decompose()
    for comment in list(soup.find_all(string=lambda value:isinstance(value, Comment))): comment.extract()
    for element in soup.find_all(True):
        for name in list(element.attrs):
            if name.startswith('on'):
                element['data-ps-'+name] = element[name]
                del element[name]
        for name in ['src','href','action']:
            if element.has_attr(name): element[name] = re.sub(r'https://petrosoft.ymtsindia.in/+', '/petrosoft/', element[name]).replace('/petrosoft/assets/', '/petrosoft-assets/assets/')
    for select in soup.select('select'):
        name=re.sub(r'\[.*','',select.get('name',''))
        relation=relations.get(name)
        if relation:
            select['data-ps-relation']=relation
            for option in list(select.select('option')):
                if option.get('value','') not in ['', 'all', 'All']:option.decompose()
        else:
            for option in select.select('option'):option.attrs.pop('selected',None)
    for field in soup.select('input,textarea'):
        if field.get('type') not in ['button','submit','radio','checkbox']: field['value']=''
        field.attrs.pop('checked',None)
        if field.name=='textarea': field.string=''
    for text in list(soup.find_all(string=True)):
        if text.parent.name=='style':continue
        cleaned=str(text)
        for name in sorted(private_names,key=len,reverse=True):
            if name.casefold() in cleaned.casefold():cleaned=re.sub(re.escape(name),'',cleaned,flags=re.I)
        if cleaned!=str(text):text.replace_with(cleaned)
    return soup

if (private/'nozzle-fragment.html').exists():
    soup=BeautifulSoup((private/'nozzle-fragment.html').read_text(), 'html5lib')
    row=soup.select_one('.product_info')
    sanitize(row)
    row['data-ps-row']='1'
    (destination/'meter.html').write_text(str(row))

if (private/'stock-fragment.html').exists():
    soup=BeautifulSoup((private/'stock-fragment.html').read_text(), 'html5lib')
    field=soup.select_one('[name="stk_tank[T1]"]')
    row=field.find_parent(class_='kgn-details-grids') if field else None
    if row:
        sanitize(row)
        row['data-ps-row']='1'
        aliases={'stk_prod':'product','openstk_val':'open_stock','receipt_val':'receipt','totstk_val':'total_stk','metersale_val':'meter_sale','cls_stock':'close_stock','clsdip_read':'dip_reading','clsdip_stock':'dip_stock','stk_vari':'stk_variation','stk_evapamnt':'vari_amnt','stk_rateRevisamnt':'rate_revision','hydro_read':'hydrometer_read'}
        for field in row.select('[name]'):
            old=field['name'].replace('[]','')
            if old.startswith('stk_tank['):field['name']='tank_no[]'
            else:field['name']=aliases.get(old,old)+'[]'
            field['data-ps-field']=field['name']
        for text in list(row.find_all(string=True)):
            if 'T1-35' in text:text.replace_with(str(text).replace('T1-35','__TANK_LABEL__'))
        (destination/'stock.html').write_text(str(row))

extra=Path('/tmp/petrosoft-extra-reference')
for path in extra.glob('*.source.html'):
    soup=BeautifulSoup(path.read_text(), 'html5lib')
    content=soup.select_one('.content-wrapper') or soup.body
    sanitize(content)
    for table in content.select('table'):
        if table.tbody:table.tbody.clear()
    for field in content.select('input,textarea'):
        if field.get('type') not in ['button','submit','radio','checkbox']:field['value']=''
    (destination/(path.name.split('.')[0]+'.html')).write_text(str(content))
print(json.dumps({'fragments':len(list(destination.glob('*.html')))}))
