import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/petrosoft"))
spec = importlib.util.spec_from_file_location("fetch_source", ROOT / "scripts/petrosoft/fetch-source.py")
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


class SourceRequests(unittest.TestCase):
    def test_all_organizations_does_not_become_the_first_customer(self):
        form = BeautifulSoup('<form><select name="credit_org"><option value="">All Organizations</option><option value="1">Fixture customer</option></select></form>', 'html.parser').form
        self.assertEqual(source.fields_for(form, '2024-01-01', '2026-01-01'), {'credit_org': ['']})

    def test_required_customer_and_all_product_values_are_sent_with_full_employee_date_range(self):
        form = BeautifulSoup('<form><input name="dt"><input name="dt2"><select name="credit_org" required><option value="">Choose customer</option><option value="1">Fixture customer</option></select><select name="product[]" multiple><option value="">Choose product</option><option value="1">MS</option><option value="2">HSD</option></select><select name="lpg_nm[]" multiple></select></form>', 'html.parser').form
        fields = source.fields_for(form, '2024-01-01', '2026-01-01')
        self.assertEqual(fields['dt'], ['2024-01-01'])
        self.assertEqual(fields['dt2'], ['2026-01-01'])
        self.assertEqual(fields['credit_org'], ['1'])
        self.assertEqual(fields['product[]'], ['1', '2'])
        self.assertEqual(fields['lpg_nm[]'], [''])

    def test_business_mutations_and_other_origins_are_refused_before_network_access(self):
        with tempfile.TemporaryDirectory() as directory:
            client = source.Source(Path(directory) / 'session.json', 0)
            with patch.object(client.session, 'request') as network:
                for path in ['/app/credit/save_billing', '/app/settlement/save', '/app/einvoice/cancel_ewaybill_ajax']:
                    with self.assertRaises(PermissionError):
                        client.fetch(path, {})
                with self.assertRaises(ValueError):
                    client.fetch('https://example.invalid/records')
                network.assert_not_called()

    def test_credential_columns_are_removed_without_dropping_financial_columns(self):
        soup = BeautifulSoup('<table><thead><tr><th>Date</th><th>Password</th><th>Amount</th></tr></thead><tbody><tr><td>2024-01-01</td><td>fixture-secret</td><td>10</td></tr></tbody></table>', 'html.parser')
        table = source.table_data(soup)[0]
        self.assertEqual(table['headers'], ['Date', 'Amount'])
        self.assertEqual(table['rows'], [['2024-01-01', '10']])

    def test_an_existing_session_cannot_be_relabelled_as_another_station(self):
        with tempfile.TemporaryDirectory() as directory:
            client = source.Source(Path(directory) / 'session.json', 0)
            with self.assertRaises(PermissionError):
                client.require_station('FIXTURE-A')
            client.reference_code = 'FIXTURE-A'
            client.require_station('FIXTURE-A')
            with self.assertRaises(PermissionError):
                client.require_station('FIXTURE-B')

    def test_monthly_retries_cover_partial_months_and_leap_days_without_overlap(self):
        self.assertEqual(list(source.monthly_ranges('2024-01-17', '2024-03-02')), [
            ('2024-01-17', '2024-01-31'), ('2024-02-01', '2024-02-29'), ('2024-03-01', '2024-03-02'),
        ])
        self.assertEqual(list(source.monthly_ranges('2024-12-31', '2025-01-01')), [
            ('2024-12-31', '2024-12-31'), ('2025-01-01', '2025-01-01'),
        ])
        with self.assertRaises(ValueError):
            list(source.monthly_ranges('2025-01-01', '2024-12-31'))

    def test_customer_retry_range_includes_payments_and_excludes_other_customers(self):
        native = {'tables': {
            'k_custcredits': [{'custorg_id': '1', 'credit_date': '2025-04-01'}, {'custorg_id': '2', 'credit_date': '2024-06-01'}],
            'k_recovery': [{'organization': '1', 'date': '2025-03-17'}, {'organization': '2', 'date': '2024-04-01'}],
            'k_cust': [{'cust_id': '1', 'op_date': None}],
        }}
        self.assertEqual(source.timeout_range(native, 1, '1', '2024-03-01', '2026-11-03'), {'from': '2025-03-17', 'to': '2026-11-03'})
        self.assertEqual(source.timeout_range(native, 17, None, '2024-03-01', '2026-11-03'), {'from': '2024-06-01', 'to': '2026-11-03'})


if __name__ == '__main__':
    unittest.main()
