"""Offline component checks; these do not execute an agent."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / 'core/skills/aqg-test-quality-review/scripts/aqg_test_quality_review.py'
ROUTER = ROOT / 'core/skills/skill-router/scripts/skill_router.py'


def run(script, *args, cwd):
    env = dict(os.environ, ZCODE_SKILL_ROUTER_NO_CACHE='1',
               PYTHONIOENCODING='utf-8', PYTHONUTF8='1')
    return subprocess.run([sys.executable, '-B', str(script), *map(str, args)],
    cwd=cwd, env=env, text=True, encoding='utf-8',
    capture_output=True, timeout=30)


def diff(path, lines):
    return (f'diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n'
    f'@@ -0,0 +1,{len(lines)} @@\n' + ''.join('+' + x + '\n' for x in lines))


class OfflineComponents(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='offline eval 空格 ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def analyze(self, text):
        path = self.root / '输入 patch.diff'
        path.write_text(text, encoding='utf-8')
        p = run(QUALITY, 'analyze', '--diff-file', path, '--json', cwd=self.root)
        self.assertEqual(p.returncode,0, p.stderr)
        return json.loads(p.stdout)

    def test_shape_only_vs_behavior_assertion(self):
        shape = self.analyze(diff('tests/test_login.py', ['def test_login():', ' assert isinstance(login(), dict)']))
        mixed = self.analyze(diff('tests/test_login.py', ['def test_login():', ' assert isinstance(login(), dict)', " assert login()['user'] == 'alice'"]))
        self.assertIn('shape_over_behavioral', {c['concern'] for c in shape['candidates']})
        self.assertNotIn('shape_over_behavioral', {c['concern'] for c in mixed['candidates']})

    def test_suppression_and_source_without_tests(self):
        result = self.analyze(diff('tests/test_login.py', ["@pytest.mark.skip(reason='broken')", 'def test_login(): pass']) + diff('src/login.py', ['def login(): pass']))
        self.assertIn('skip_added', {c['subtype'] for c in result['candidates']})
        missing = self.analyze(diff('src/login.py', ['def login(): pass']))
        self.assertIn('coverage_gap', {c['concern'] for c in missing['candidates']})

    def test_empty_diff_and_missing_file_failures(self):
        self.assertEqual(self.analyze('')['candidates'], [])
        p = run(QUALITY, 'analyze', '--diff-file', self.root / '不存在.diff', '--json', cwd=self.root)
        self.assertNotEqual(p.returncode,0)

    def test_router_relevance_empty_and_unicode_space_paths(self):
        skills = self.root / 'skills 空格'
        skill = skills / 'backup-scheduler'
        skill.mkdir(parents=True)
        (skill / 'SKILL.md').write_text('---\nname: backup-scheduler\ndescription: Schedule recurring crontab backup jobs.\n---\n# Backup\n', encoding='utf-8')

        def route(task):
            p = run(ROUTER, task, '--skills-dir', skills, '--json', cwd=self.root)
            self.assertEqual(p.returncode,0, p.stderr)
            return json.loads(p.stdout)

        relevant = route('schedule recurring crontab backup jobs')
        self.assertEqual(relevant['results'][0]['skill'], 'backup-scheduler')
        self.assertEqual(route('你好')['results'], [])
        self.assertEqual(relevant, route('schedule recurring crontab backup jobs'))

    @unittest.skip('真实宿主 Agent、模型决策和工具调用未在离线组件评测中执行')
    def test_real_host_agent_behavior(self):
        pass


if __name__ == '__main__':
    unittest.main(verbosity=2)
