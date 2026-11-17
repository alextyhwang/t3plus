"""Browser checks of synthetic widget data. No T3 session or service writes.
Run node harness/assistantWidgets.mjs first, then this script.
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect

out = Path(__file__).resolve().parent / 'out' / 'assistant-widgets'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 440, 'height': 780}, device_scale_factor=2)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto((out / 'index.html').as_uri())
    page.wait_for_load_state('networkidle')
    expect(page.locator('.t3plus-info-event')).to_have_count(2)
    expect(page.locator('[data-task-category]')).to_have_count(0)
    expect(page.locator('form, input, [type=submit]')).to_have_count(0)
    link = page.locator('.t3plus-task-source').first
    assert len(link.get_attribute('href')) > 240
    assert link.inner_text() == 'Course portal'
    page.screenshot(path=str(out / 'default.png'))

    options = page.locator('[data-task-options]').first
    options.focus()
    page.keyboard.press('Enter')
    category = page.locator('[data-task-category]')
    expect(category).to_be_focused()
    category.select_option('personal')
    expect(page.locator('[data-task-complete]').first).to_be_disabled()
    expect(page.locator('[data-task-complete]').nth(1)).to_be_enabled()
    page.evaluate('window.finish(false)')
    expect(page.get_by_role('status')).to_contain_text('Could not save')
    page.keyboard.press('Escape')
    expect(page.locator('[data-task-options]').first).to_be_focused()
    expect(page.locator('[data-task-category]')).to_have_count(0)

    check = page.get_by_role('checkbox').first
    check.focus()
    page.keyboard.press('Space')
    expect(check).to_be_disabled()
    expect(check).to_have_attribute('aria-checked', 'false')
    assert page.evaluate('calls.filter(c => c.kind === "complete").length') == 1
    page.evaluate('window.finish()')
    expect(check).to_be_enabled()

    page.get_by_role('button', name='Next day', exact=True).focus()
    page.keyboard.press('Enter')
    expect(page.locator('.t3plus-info-event')).to_have_count(1)
    expect(page.locator('.t3plus-info-event')).to_have_text('Planning day')
    expect(page.locator('.t3plus-info-calendar h3 > a time')).to_have_attribute('datetime', '2026-11-17')
    expect(page.locator('.t3plus-info-calendar h3 > a')).to_have_text('Tuesday, Nov 17')
    expect(page.locator('.t3plus-info-clock')).to_have_text('Now 11:00 AM')
    expect(page.locator('.t3plus-info-calendar header [data-info-day]')).to_have_count(2)
    expect(page.get_by_role('button', name='Next day', exact=True)).to_be_focused()
    page.screenshot(path=str(out / 'next-day.png'))
    page.get_by_role('button', name='Next day', exact=True).click()
    expect(page.locator('.t3plus-info-message')).to_have_text('No upcoming events for this day.')
    page.get_by_role('button', name='Previous day', exact=True).click()
    expect(page.locator('.t3plus-info-event')).to_have_text('Planning day')
    expect(page.locator('details')).to_have_count(0)
    assert page.locator('.t3plus-info-event-body').evaluate('el => getComputedStyle(el).borderLeftColor') == 'rgb(142, 36, 170)'

    for mode in ['loading', 'empty', 'error', 'signin', 'stale']:
        page.evaluate('(mode) => { window.setTasks(mode); window.setCalendar(mode); }', mode)
        page.wait_for_timeout(50)
        page.screenshot(path=str(out / f'{mode}.png'))
        if mode == 'signin':
            expect(page.get_by_text('Sign in with passkey', exact=True)).to_have_count(2)
        if mode == 'stale':
            expect(page.locator('.t3plus-info-calendar h3')).to_contain_text('Stale')
            expect(page.get_by_role('checkbox')).to_have_count(18)
    page.evaluate('window.setTasks("ready"); window.setCalendar("ready")')
    page.get_by_role('button', name='Refresh tasks', exact=True).click()
    page.wait_for_timeout(50)

    geometry = []
    for width, height in [(360, 680), (280, 440), (240, 320)]:
        page.set_viewport_size({'width': width + 40, 'height': height + 64})
        page.locator('#fixture').evaluate('(el, size) => {el.style.width=size[0]+"px";el.style.height=size[1]+"px"}', [width, height])
        metrics = page.locator('#fixture').evaluate('''el => {
          const list = el.querySelector('.t3plus-tasks-list');
          return {width:el.clientWidth, scrollWidth:el.scrollWidth, listHeight:list.clientHeight,
            listScrollHeight:list.scrollHeight, listWidth:list.clientWidth, listScrollWidth:list.scrollWidth};
        }''')
        assert metrics['scrollWidth'] <= metrics['width'], metrics
        assert metrics['listScrollWidth'] <= metrics['listWidth'], metrics
        assert metrics['listHeight'] >= 48, metrics
        page.locator('.t3plus-tasks-list').focus()
        page.keyboard.press('End')
        page.wait_for_timeout(400)
        assert page.locator('.t3plus-tasks-list').evaluate('el => el.scrollTop') > 0
        page.locator('.t3plus-tasks-list').evaluate('el => el.scrollTop = 0')
        page.locator('#fixture').evaluate('el => el.scrollTop = 0')
        page.locator('.t3plus-tasks-list').blur()
        page.wait_for_timeout(150)
        page.screenshot(path=str(out / f'{width}x{height}.png'))
        if height == 320:
            page.get_by_role('checkbox').first.scroll_into_view_if_needed()
            expect(page.get_by_role('checkbox').first).to_be_in_viewport()
            page.screenshot(path=str(out / 'short-scrolled.png'))
        geometry.append(metrics)

    page.set_viewport_size({'width': 440, 'height': 780})
    page.locator('#fixture').evaluate('el => {el.style.width="360px";el.style.height="680px";el.scrollTop=0}')
    page.evaluate('''() => { for (const [key,value] of Object.entries({background:'#ffffff',foreground:'#27272a','muted-foreground':'#71717a',border:'#e4e4e7',accent:'#f4f4f5',ring:'#52525b',destructive:'#b91c1c',secondary:'#f4f4f5'})) document.documentElement.style.setProperty('--'+key,value); document.documentElement.style.colorScheme='light'; }''')
    page.screenshot(path=str(out / 'light.png'))
    page.emulate_media(forced_colors='active', reduced_motion='reduce')
    expect(page.get_by_role('checkbox').first).to_be_visible()
    page.screenshot(path=str(out / 'forced-colors.png'))
    assert not errors, errors
    (out / 'results.json').write_text(json.dumps({'fixture': True, 'checks': 'keyboard, category, completion locks, day navigation, states, scrolling, constrained widths, forced colors', 'geometry': geometry, 'errors': errors}, indent=2))
    browser.close()
print('Synthetic widget browser checks passed; screenshots in harness/out/assistant-widgets')
