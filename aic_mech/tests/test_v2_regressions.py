"""Regression checks for model connectivity, config preservation and startup.

External model requests are mocked; these tests never use a real credential.
"""
import os
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

import config
from app.server import app
from main import available_port


class V2RegressionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        values = {
            'ENV_FILE': Path(self.temp.name) / '.env',
            'LLM_PROVIDER': 'offline', 'DEEPSEEK_API_KEY': '', 'OPENAI_API_KEY': '',
            'DEEPSEEK_BASE_URL': 'https://api.deepseek.com/v1',
            'OPENAI_BASE_URL': 'https://api.openai.com/v1', 'LLM_MODEL': 'offline-rule-engine',
            'USE_ONLINE_LLM': False, 'ONLINE_LLM_ENABLED': False,
            'LLM_CONNECTION_OK': None, 'LLM_CONNECTION_TESTED_AT': '', 'LLM_CONNECTION_MESSAGE': '',
        }
        self.patches = patch.multiple(config, **values)
        self.patches.start()
        self.addCleanup(self.patches.stop)
        self.env_patch = patch.dict(os.environ, {'USE_OFFLINE_ONLY': 'true', 'USE_ONLINE_LLM': 'false'})
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.client = TestClient(app)

    def configure(self, **extra):
        return self.client.post('/api/config/llm', json={
            'provider': 'custom', 'base_url': 'http://127.0.0.1:11434/v1',
            'model': 'local-training-model', 'test_connection': True, **extra,
        })

    def test_compatible_reply_saves_success_without_exposing_key(self):
        response = httpx.Response(200, json={'choices': [{'message': {'content': 'OK'}}]})
        with patch('httpx.AsyncClient.post', new_callable=AsyncMock, return_value=response) as post:
            result = self.configure(base_url='http://127.0.0.1:11434/v1/chat/completions', api_key='dummy-local-key').json()
        self.assertTrue(result['connection_ok'])
        self.assertTrue(result['connection_tested_at'])
        self.assertEqual(post.call_args.args[0], 'http://127.0.0.1:11434/v1/chat/completions')
        readback = self.client.get('/api/config/llm').json()
        self.assertTrue(readback['connection_ok'])
        self.assertNotIn('dummy-local-key', str(readback))

    def test_http_200_without_a_model_reply_is_not_connected(self):
        with patch('httpx.AsyncClient.post', new_callable=AsyncMock, return_value=httpx.Response(200, text='<html>login</html>')):
            result = self.configure().json()
        self.assertTrue(result['connection_tested'])
        self.assertFalse(result['connection_ok'])
        self.assertIn('未返回有效模型回复', result['message'])

    def test_auth_failure_and_timeout_are_visible(self):
        with patch('httpx.AsyncClient.post', new_callable=AsyncMock, return_value=httpx.Response(401)):
            result = self.configure().json()
        self.assertFalse(result['connection_ok'])
        self.assertIn('401', result['message'])
        with patch('httpx.AsyncClient.post', new_callable=AsyncMock, side_effect=httpx.ReadTimeout('test timeout')):
            result = self.configure().json()
        self.assertFalse(result['connection_ok'])
        self.assertIn('超时', result['message'])

    def test_saving_then_offline_preserves_unrelated_configuration(self):
        config.ENV_FILE.write_text('HOST=127.0.0.1\nPORT=8123\nDEBUG=false\nMY_SETTING=keep\n', encoding='utf-8')
        self.assertEqual(self.configure(test_connection=False).status_code, 200)
        self.assertEqual(self.client.post('/api/config/llm', json={'provider': 'offline'}).status_code, 200)
        saved = config.ENV_FILE.read_text(encoding='utf-8')
        self.assertIn('PORT=8123', saved)
        self.assertIn('MY_SETTING=keep', saved)
        self.assertFalse(config.is_online_llm_active())

    def test_invalid_url_or_multiline_values_never_write_config(self):
        self.assertEqual(self.configure(base_url='ftp://localhost/v1/chat/completions').status_code, 400)
        self.assertEqual(self.configure(model='bad\nPORT=8888').status_code, 422)
        self.assertFalse(config.ENV_FILE.exists())

    def test_busy_port_is_skipped_and_original_server_is_untouched(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            port = listener.getsockname()[1]
            selected = available_port('127.0.0.1', port)
            self.assertNotEqual(selected, port)
            self.assertEqual(listener.getsockname()[1], port)

    def test_merged_case_catalogue_can_start_a_general_case(self):
        cases = self.client.get('/api/case/list').json()
        ids = {item['case_id'] for item in cases}
        self.assertTrue({'case_chest_pain_001', 'case_gam_001_common_cold', 'case_gam_005_appendicitis'} <= ids)
        detail = self.client.get('/api/case/detail/case_gam_001_common_cold')
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()['patient_profile']['name'], '王秀兰')

        started = self.client.post('/api/case/start', json={
            'case_id': 'case_gam_001_common_cold', 'student_name': 'catalogue-test'
        })
        self.assertEqual(started.status_code, 200)
        session_id = started.json()['session_id']
        inquiry = self.client.post('/api/action/execute', json={
            'session_id': session_id, 'action_type': 'inquiry', 'content': '请问主要症状是什么？'
        })
        self.assertEqual(inquiry.status_code, 200)
        report = self.client.post('/api/action/execute', json={
            'session_id': session_id, 'action_type': 'lab_order', 'content': '血常规'
        })
        self.assertEqual(report.status_code, 200)
        self.assertTrue(report.json()['report'])


if __name__ == '__main__':
    unittest.main()
