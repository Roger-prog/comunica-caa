import os
import tempfile
import unittest
from pathlib import Path

_initial = tempfile.TemporaryDirectory()
os.environ['COMUNICA_DB'] = str(Path(_initial.name) / 'initial.sqlite3')
from fastapi.testclient import TestClient
import app as module


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        module.DB_PATH = Path(self.tmp.name) / 'test.sqlite3'
        module.init_db()
        self.client = TestClient(module.app)
        self.owner = self.register('owner@example.com')
        self.other = self.register('other@example.com')
        self.pro = self.register('pro@example.com', 'fonoaudiologo')
        self.child = self.client.post('/children', json={'name': 'Criança teste'}, headers=self.owner).json()['id']
        self.path = f'/children/{self.child}'
        self.word = self.client.get(self.path + '/words', headers=self.owner).json()[0]

    def tearDown(self):
        self.client.close()
        self.tmp.cleanup()

    def register(self, email, role='responsavel'):
        response = self.client.post('/auth/register', json={'name': 'Teste', 'email': email, 'password': 'senha-teste-12345', 'role': role})
        self.assertEqual(response.status_code, 201)
        return {'Authorization': 'Bearer ' + response.json()['token']}

    def event(self, kind='use', stage=0, rid='unique-request-0001', **extra):
        return self.client.post(self.path + '/events', headers=self.owner, json={'word_id': self.word['id'], 'kind': kind, 'stage': stage, 'request_id': rid, **extra})

    def test_auth_persistence_and_logout(self):
        self.assertEqual(self.client.get('/children').status_code, 401)
        module.init_db()  # Reopening the file preserves records.
        self.assertEqual(len(self.client.get('/children', headers=self.owner).json()), 1)
        with module.db() as db:
            stored = db.execute('SELECT password_hash FROM users LIMIT 1').fetchone()[0]
            self.assertNotIn('senha-teste', stored)
        self.assertEqual(self.client.post('/auth/login', json={'email': 'OWNER@example.com', 'password': 'senha-teste-12345'}).status_code, 200)
        self.assertEqual(self.client.post('/auth/login', json={'email': 'owner@example.com', 'password': 'incorreta-123'}).status_code, 401)
        self.assertEqual(self.client.post('/auth/logout', headers=self.owner).status_code, 204)
        self.assertEqual(self.client.get('/auth/me', headers=self.owner).status_code, 401)

    def test_access_grant_and_revoke(self):
        for route in ['/words', '/events', '/report', '/report.csv', '/members']:
            self.assertEqual(self.client.get(self.path + route, headers=self.other).status_code, 403)
        self.assertEqual(self.client.get('/children', headers=self.pro).json(), [])
        self.assertEqual(self.client.post(self.path + '/members', json={'email': 'pro@example.com'}, headers=self.owner).status_code, 201)
        self.assertEqual(len(self.client.get('/children', headers=self.pro).json()), 1)
        self.assertEqual(self.client.get(self.path + '/report', headers=self.pro).status_code, 200)
        self.assertEqual(self.client.post('/children', headers=self.pro, json={'name': 'Não permitido'}).status_code, 403)
        self.assertEqual(self.client.post(self.path + '/members', json={'email': 'other@example.com'}, headers=self.pro).status_code, 403)
        uid = self.client.get('/auth/me', headers=self.pro).json()['id']
        self.client.delete(f'{self.path}/members/{uid}', headers=self.owner)
        self.assertEqual(self.client.get(self.path + '/report', headers=self.pro).status_code, 403)

    def test_use_is_not_mastery_and_retry_is_idempotent(self):
        first = self.event()
        self.assertEqual(first.status_code, 201)
        self.assertEqual(self.event().json()['id'], first.json()['id'])
        result = self.client.get(self.path + '/report', headers=self.owner).json()
        self.assertEqual(result['total_uses'], 1)
        self.assertEqual(result['mastered'], 0)
        self.assertIsNone(result['words'][0]['stage'])
        self.assertEqual(self.event(stage=3, rid='another-request-0001').status_code, 422)
        self.assertEqual(self.event('evolution', 3, 'evaluation-000001', note='Falou espontaneamente').status_code, 201)
        self.event(rid='another-request-0002')
        self.assertEqual(self.client.get(self.path + '/report', headers=self.owner).json()['mastered'], 1)
        self.event('evolution', 1, 'evaluation-000002')
        self.assertEqual(self.client.get(self.path + '/report', headers=self.owner).json()['mastered'], 0)

    def test_word_edit_archive_and_historical_label(self):
        self.event()
        edited = {k: self.word[k] for k in ('label', 'symbol', 'category')}
        edited.update(label='Água gelada', active=False)
        url = f'{self.path}/words/{self.word["id"]}'
        self.assertEqual(self.client.put(url, headers=self.owner, json=edited).status_code, 200)
        self.assertEqual(self.event(rid='another-request-0001').status_code, 409)
        self.assertEqual(self.event().status_code, 201)  # Existing retry survives archive.
        events = self.client.get(self.path + '/events', headers=self.owner).json()
        self.assertEqual(events[0]['word_label'], 'Água')
        self.assertEqual(self.client.get(self.path + '/report', headers=self.owner).json()['total_uses'], 1)

    def test_cross_child_word_and_invalid_stage_rejected(self):
        child2 = self.client.post('/children', json={'name': 'Outro perfil'}, headers=self.owner).json()['id']
        self.assertEqual(self.client.post(f'/children/{child2}/events', headers=self.owner, json={'word_id': self.word['id'], 'kind': 'use', 'stage': 0, 'request_id': 'cross-child-request'}).status_code, 404)
        self.assertEqual(self.event('evolution', 4).status_code, 422)
        self.assertEqual(self.client.post('/children', headers=self.owner, json={'name': '   '}).status_code, 422)

    def test_csv_unicode_formula_escape_and_pagination(self):
        data = {'label': '=formula', 'symbol': '💬', 'category': '+categoria'}
        self.client.post(self.path + '/words', headers=self.owner, json=data)
        response = self.client.get(self.path + '/report.csv', headers=self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertIn("'=formula", response.text)
        self.assertIn("'+categoria", response.text)
        self.assertIn('Criança teste', response.text)
        for i in range(52):
            self.event(rid=f'pagination-request-{i:04}')
        first = self.client.get(self.path + '/events', headers=self.owner).json()
        second = self.client.get(self.path + f'/events?before={first[-1]["id"]}', headers=self.owner).json()
        self.assertEqual(len(first), 50)
        self.assertEqual(len(second), 2)

    def test_period_counts_use_utc_calendar_days(self):
        self.event()
        with module.db() as db:
            db.execute("UPDATE events SET created_at='2020-01-01T00:00:00+00:00'")
        result = self.client.get(self.path + '/report?days=7', headers=self.owner).json()
        self.assertEqual(result['total_uses'], 0)
        self.assertEqual(result['daily'], [])
        self.assertEqual(self.client.get(self.path + '/report?days=0', headers=self.owner).status_code, 422)


if __name__ == '__main__':
    unittest.main()
