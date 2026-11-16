"""AI crawlers are welcome (owner, 2026-11-16: "i dont want to block AI"). Cloudflare's "Block AI
bots" and its AI Labyrinth (`crawler_protection`, a maze of decoy pages for crawlers) stood on in
terraform/zone.tf; the dashboard had already turned the first off, and an apply turned it back on.
What would break silently: either switch drifting back on, or a robots.txt shutting out an AI
crawler by name. Both robots files keep their own rules for the forum, which are about the
worker's request budget, not about AI."""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AI_AGENTS = ('GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'anthropic-ai',
             'CCBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bytespider',
             'Meta-ExternalAgent', 'Amazonbot', 'cohere-ai')


class AiOpen(unittest.TestCase):
    def test_cloudflare_blocks_no_ai(self):
        with open(os.path.join(ROOT, 'terraform', 'zone.tf'), encoding='utf-8') as f:
            tf = f.read()
        block = re.search(r'resource "cloudflare_bot_management" "main" \{(.*?)\n\}', tf, re.S).group(1)
        self.assertRegex(block, r'\n\s*ai_bots_protection\s*=\s*"disabled"')
        self.assertRegex(block, r'\n\s*crawler_protection\s*=\s*"disabled"')

    def test_no_robots_file_turns_an_ai_crawler_away(self):
        for path in ('docs/robots.txt', 'press/scripts/build.ts'):
            with open(os.path.join(ROOT, path), encoding='utf-8') as f:
                text = f.read()
            # each User-agent group's lines, up to the next group
            for m in re.finditer(r'User-agent:\s*(\S+)((?:\\n|\n)(?!User-agent)[^\n]*)*', text):
                agent, group = m.group(1), m.group(0)
                if agent in AI_AGENTS:
                    self.assertNotRegex(group, r'Disallow:\s*/\s*($|\\n)', path + ': ' + agent + ' is shut out')


if __name__ == '__main__':
    unittest.main()
