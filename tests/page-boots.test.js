// Loads index.html with scripts RUNNING but no network -- the exact situation
// that shipped "the admin side is completely glitched out": Chart.js became a
// deferred script, and one inline line touching Chart.defaults at parse time
// threw, killing the entire main script block (most of the app). Static
// regexes cannot catch execution-order bugs; actually executing the page can.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('the inline app scripts survive parse even if every CDN script is missing', async () => {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String((e && e.detail && e.detail.message) || e.message || e)));
  const dom = new JSDOM(html, {
    url: 'http://localhost/', runScripts: 'dangerously', virtualConsole: vc,
    beforeParse(w) {
      w.fetch = () => new Promise(() => {}); // hang, like a dead network
      w.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {}, removeEventListener() {} });
    }
  });
  await new Promise(r => setTimeout(r, 1200));
  const w = dom.window;
  assert.deepEqual(errors, [], 'no script in the page may throw, even with Chart/GridStack absent:\n' + errors.join('\n'));
  assert.equal(typeof w.showView, 'function', 'the main script block reached its end');
  assert.equal(typeof w.openClient, 'function');
  assert.equal(typeof w.apiMe, 'function');
  dom.window.close();
});
