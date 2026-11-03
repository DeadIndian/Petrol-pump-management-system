"""Extract report column labels and output formats, without retaining business rows."""
import json
from pathlib import Path
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, '/tmp/petrosoft-parser')
from bs4 import BeautifulSoup
project=Path(__file__).resolve().parents[2]
source=Path('/tmp/petrosoft-report-reference')
catalog=json.loads((project/'lib/petrosoft/catalog.json').read_text())
reports=next(module for module in catalog if module['id']=='reports')['forms']
private=json.loads((project/'.petrosoft/native.json').read_text()).get('tables',{})
names={str(row.get('org_name','')).casefold().strip() for row in private.get('k_cust',[])}
output=[]
def excel_headers(path, row_number=1):
    ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as archive:
        shared=[]
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared=[''.join(item.itertext()) for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si',ns)]
        sheet=ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
        cells=sheet.findall(f"s:sheetData/s:row[@r='{row_number}']/s:c",ns)
        labels=[]
        for cell in cells:
            value=cell.find('s:v',ns)
            if cell.get('t')=='s' and value is not None:labels.append(shared[int(value.text)])
            elif cell.get('t')=='inlineStr':labels.append(''.join(cell.find('s:is',ns).itertext()))
            else:labels.append(value.text if value is not None else '')
        return labels
for form in reports:
    if form['operation']!='report':continue
    row={'index':form['index'],'action':form['action'],'title':form['title'],'format':'html','tables':[]}
    if form['index']==29:row['title']='Day Business Summary'
    metadata=source/(str(form['index'])+'.json')
    if metadata.exists():
        information=json.loads(metadata.read_text())
        row['format']='xlsx' if 'spreadsheet' in information.get('type','') else 'xml' if 'xml' in information.get('type','') and 'html' not in information.get('type','') else 'html'
    html=source/(str(form['index'])+'.html')
    if html.exists():
        soup=BeautifulSoup(html.read_text(), 'html5lib')
        for table in soup.select('table'):
            headers=[cell.get_text(' ',strip=True) for cell in table.select('thead th,thead td')]
            if not headers:
                first=table.find('tr')
                if first:headers=[cell.get_text(' ',strip=True) for cell in first.find_all('th',recursive=False)]
            if not headers or any(header.casefold().strip() in names for header in headers):continue
            if len(headers)>100 or any(len(header)>180 for header in headers):continue
            headers=[re.sub(r'\s+',' ',header) for header in headers]
            row['tables'].append({'headers':headers,'class':' '.join(table.get('class',[]))})
    binary=source/(str(form['index'])+'.bin')
    if row['format']=='xlsx' and binary.exists():
        row['tables']=[{'headers':excel_headers(binary,4 if form['index']==66 else 1),'class':'tally-export'}]
    output.append(row)
(project/'lib/petrosoft/reports.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')))
print(json.dumps({'reports':len(output),'columnLayouts':sum(bool(report['tables']) for report in output),'spreadsheetReports':sum(report['format']=='xlsx' for report in output)}))
