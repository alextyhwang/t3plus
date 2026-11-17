"""Verify the actual release ZIP with synthetic sidebar data in Chromium.

Usage: py -3.12 harness/packageCheck.py [release/t3plus-vVERSION.zip]
(defaults to the ZIP for package.json's version; `npm run release:check`).
Reads only src/personal.js, never live feeds or credentials. All requests
are intercepted. The real packaged content script renders the test controls.
"""
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlencode, urlparse
from zipfile import ZipFile
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
zip_path = sys.argv[1] if len(sys.argv) > 1 else root / 'release' / f't3plus-v{version}.zip'
# The Assistant ids and the fixture page, with those ids swapped in (harness/fixture.mjs).
fixture = json.loads(subprocess.run(
    ['node', '--input-type=module', '-e', "import { readFileSync } from 'node:fs'; import { ASSISTANT_GROUP } from './src/personal.js'; import { withAssistantIds } from './harness/fixture.mjs'; "
     "console.log(JSON.stringify({ group: ASSISTANT_GROUP, html: withAssistantIds(readFileSync('harness/index.html', 'utf8')) }))"],
    cwd=root, capture_output=True, text=True, check=True, encoding='utf-8').stdout)
# Without an Assistant group (the default src/personal.js), the fixture keeps its
# placeholder ids and the group must not render.
group, html = fixture['group'], fixture['html']
bot_id = group['botThreadId'] if group else 'bot1'
project_id = group['projectId'] if group else 'p-ops'
with ZipFile(zip_path) as archive:
    prefix = next(n for n in archive.namelist() if n.endswith('/manifest.json')).rsplit('/', 1)[0]
    files = {n[len(prefix) + 1:]: archive.read(n) for n in archive.namelist() if n.startswith(prefix + '/')}
manifest = json.loads(files['manifest.json'])
for asset in ['wallpaper-aurora.svg', 'wallpaper-contours.svg', 'wallpaper-facets.svg']:
    assert 'assets/' + asset in files

feed = {'version': 1, 'environmentId': 'env1', 'bots': {
    bot_id: {'projectId': project_id, 'status': 'idle', 'text': ''}},
    'threads': {'o1': {'title': 'Draft release notes', 'projectId': project_id, 'status': 'working'}}}
# Simulate the restored local override that caused the regression: it is valid,
# but no visible row uses its custom marker. The packaged app must recover the
# built-in marker while keeping a custom marker authoritative when it is used.
settings = {
    'version': 2,
    'sidebar': {'profiles': True, 'bots': True, 'compactHeader': True, 'titleFirst': True},
    'home': {'widgets': True},
}
local_config = {'use': 'local', 'text': json.dumps({'version': 1, 'botMarker': '[[old:bot]]', 'profiles': []}), 'savedAt': 1}
query = urlencode({
    'group': '1',
    'feed': json.dumps(feed),
    'config': json.dumps({'version': 1, 'profiles': []}),
    'seed': json.dumps(settings),
    'localConfig': json.dumps(local_config),
})
MIME = {'.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png'}
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    def route(request):
        path = urlparse(request.request.url).path
        if path.startswith('/dist/') and path[6:] in files:
            mime = MIME.get(Path(path).suffix, 'application/octet-stream')
            request.fulfill(body=files[path[6:]], content_type=mime)
        elif path == '/harness/chrome-stub.js':
            request.fulfill(body=(root / 'harness/chrome-stub.js').read_bytes(), content_type='text/javascript')
        elif path == '/env1/a1':
            request.fulfill(body=html, content_type='text/html')
        else:
            request.fulfill(status=404, body='Fixture only')
    page.route('**/*', route)
    page.goto('https://app.t3.codes/env1/a1?' + query)
    header = page.locator('[data-t3plus-group="header"]')
    expect(page.locator('html[data-t3plus-title-first]')).to_have_count(1)
    if group:
        expect(header).to_have_count(1)
        expect(header).to_be_visible()
    expected_bots = {
        f'env1:{bot_id}': 'Orchestrator',
        'env2:bot2': 'Release Captain',
        'env2:bot3': 'Inbox triage',
        'env2:bot4': 'Dependency Bot',
        'env2:bot5': 'Nightly sync',
    }
    expect(page.locator('[data-t3plus-bot]')).to_have_count(len(expected_bots))
    for key, label in expected_bots.items():
        row = page.locator(f'[data-sidebar-row="{key}"]')
        expect(row).to_have_attribute('data-t3plus-bot')
        avatar = row.locator('.t3plus-bot-avatar')
        expect(avatar).to_have_count(1)
        box = avatar.bounding_box()
        assert box and box['width'] >= 30 and box['height'] >= 30, key
        assert avatar.evaluate("el => getComputedStyle(el, '::before').backgroundImage") not in ('none', ''), key
        top = row.locator('[data-t3plus-bot-top]')
        expect(top).to_have_attribute('data-t3plus-bot-name', label)
        title = row.locator('[data-t3plus-bot-title]')
        expect(title).to_have_count(1)
        assert title.evaluate("el => getComputedStyle(el).fontSize") == '0px', key
        assert title.evaluate("el => getComputedStyle(el, '::after').content") != 'none', key
    if group:
        expect(page.locator('[data-t3plus-group="item"]')).not_to_have_count(0)
        assert int(header.evaluate('el => getComputedStyle(el).order')) < 0
        toggle = header.locator('button[aria-expanded]')
        expect(toggle).to_have_attribute('aria-expanded', 'true')
        toggle.click()
        expect(toggle).to_have_attribute('aria-expanded', 'false')
        toggle.click()
        expect(toggle).to_have_attribute('aria-expanded', 'true')
    else:
        expect(header).to_have_count(0)
    assert not errors, errors
    browser.close()
assistant = 'the Assistant renders above the inbox and folds/reopens' if group else 'no Assistant group (not configured)'
print(f'PASS ZIP {manifest["version"]}: wallpapers present; packaged bot rows get avatars and clean names; {assistant}; synthetic data only.')
