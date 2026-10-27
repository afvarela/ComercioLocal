import unittest
from receipt_layout import product_receipt_lines,pos_product_receipt_lines


class SharedReceiptLayoutTests(unittest.TestCase):
    def test_complete_product_detail_fits_80mm(self):
        lines = product_receipt_lines([{
            'name': 'Producto con nombre suficientemente largo para saltar de linea',
            'description': 'Descripcion detallada del producto',
            'qty': 2,
            'unit': 'und',
            'price': 400000,
            'price_basis': 1,
            'total': 800000,
        }], 42)
        text = '\n'.join(lines)
        self.assertIn('PRODUCTO', text)
        self.assertIn('VALOR', text)
        self.assertIn('2 und \u00d7 $ 4,000.00/und', text)
        self.assertIn('$ 8,000.00', text)
        self.assertTrue(all(len(line) <= 42 for line in lines))

    def test_weighted_product_matches_approved_dispatch_format(self):
        lines=product_receipt_lines([{'name':'Aguacate','qty':222,'unit':'g','price':800000,'price_basis':500}],43)
        text='\n'.join(lines)
        self.assertIn('PRODUCTO',text);self.assertIn('VALOR',text);self.assertIn('Aguacate',text)
        self.assertIn('222 g \u00d7 $ 8,000.00/libra (500 g)',text);self.assertIn('$ 3,552.00',text)
        self.assertTrue(all(len(line)<=43 for line in lines))

    def test_same_formatter_supports_58mm(self):
        lines = product_receipt_lines([{'name':'Martillo','qty':1,'unit':'und','price':250000,'total':250000}], 30)
        self.assertTrue(all(len(line) <= 30 for line in lines))

    def test_dispatch_safe_right_margin_and_wrapped_product_name(self):
        name = 'Producto extremadamente largo para ferreteria'
        lines = product_receipt_lines(
            [{'name': name, 'qty': 1, 'unit': 'und', 'price': 125000, 'total': 125000}],
            38,
            product_name_width=26,
        )
        name_lines = lines[2:-2]
        self.assertGreaterEqual(len(name_lines), 2)
        self.assertTrue(all(len(line) <= 38 for line in lines))
        self.assertLessEqual(len(name_lines[0]), 26)
        self.assertLessEqual(lines[0].index('VALOR') + len('VALOR'), 38)

    def test_pos_receipt_restores_safe_value_column(self):
        lines = pos_product_receipt_lines([
            {'name':'Aguacate','qty':111,'unit':'g','price':800000,'price_basis':500,'total':177600},
            {'name':'Producto con un nombre largo que debe continuar abajo','qty':2,'unit':'und','price':400000,'total':800000},
        ],38)
        self.assertEqual(len(lines[0]),38)
        self.assertTrue(lines[0].endswith('VALOR'))
        self.assertTrue(any(line.endswith('$ 1,776.00') for line in lines))
        self.assertFalse(any('(500 g)$' in line for line in lines))
        self.assertTrue(all(len(line)<=38 for line in lines))


if __name__ == '__main__':
    unittest.main()
