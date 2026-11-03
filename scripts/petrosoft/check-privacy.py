"""Reject captured credential values in shipped HTML without printing values."""
from html.parser import HTMLParser
from pathlib import Path
import re
import sys


class CredentialFields(HTMLParser):
    def __init__(self):
        super().__init__()
        self.findings = []

    def handle_starttag(self, tag, attributes):
        if tag != 'input':
            return
        attrs = dict(attributes)
        identity = ' '.join([attrs.get('id') or '', attrs.get('name') or ''])
        credential = attrs.get('type', '').lower() == 'password' or re.search(r'password|passwd|pwd|secret|token', identity, re.I)
        if credential and attrs.get('value'):
            self.findings.append(attrs.get('id') or attrs.get('name') or 'password input')


root = Path(__file__).resolve().parents[2]
files = sorted((root / 'lib/petrosoft/templates').glob('*.html')) + sorted((root / 'public/petrosoft-assets/fragments').glob('*.html'))
findings = []
for path in files:
    parser = CredentialFields()
    parser.feed(path.read_text())
    findings.extend(f'{path.relative_to(root)}: {field}' for field in parser.findings)
if findings:
    print('Captured credential fields must be empty:', *findings, sep='\n', file=sys.stderr)
    raise SystemExit(1)
print(f'Privacy check: {len(files)} shipped HTML files, no captured credential values.')
