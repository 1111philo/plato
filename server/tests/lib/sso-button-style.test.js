/**
 * The sign-in button's style (src/lib/sso-button-style.js): what an admin's
 * colors and icon must be before they reach the public providers payload.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buttonStyle, contrastRatio, isButtonIcon, isHexColor, ICON_MAX_LENGTH, MIN_CONTRAST } from '../../src/lib/sso-button-style.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1];
const PNG = `data:image/png;base64,${b64(PNG_BYTES)}`;
const JPEG = `data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1])}`;
const WEBP = `data:image/webp;base64,${b64([...Buffer.from('RIFF'), 36, 0, 0, 0, ...Buffer.from('WEBPVP8 '), 0, 0])}`;

describe('colors', () => {
  it('accepts only #rrggbb', () => {
    for (const ok of ['#001E62', '#ffffff', '#AbCdEf']) assert.equal(isHexColor(ok), true, ok);
    for (const bad of ['#fff', '001E62', '#001E6', '#001E622', '#gggggg', 'red', 'rgb(0,0,0)', '#001E62;background:url(x)', ' #001E62', '', null, undefined, 123, ['#001E62']]) {
      assert.equal(isHexColor(bad), false, String(bad));
    }
  });

  it('computes the WCAG contrast ratio, either way round', () => {
    assert.equal(contrastRatio('#000000', '#ffffff'), 21);
    assert.equal(contrastRatio('#ffffff', '#000000'), 21);
    assert.equal(contrastRatio('#336699', '#336699'), 1);
    // Reference values: #767676 on white is the lightest grey that passes AA.
    assert.ok(Math.abs(contrastRatio('#767676', '#ffffff') - 4.54) < 0.01);
    assert.ok(Math.abs(contrastRatio('#777777', '#ffffff') - 4.48) < 0.01);
    assert.equal(contrastRatio('#000', '#ffffff'), 0);
    assert.equal(contrastRatio(undefined, '#ffffff'), 0);
  });

  it('keeps a pair that reaches 4.5:1 and drops one that doesn’t', () => {
    assert.equal(MIN_CONTRAST, 4.5);
    assert.deepEqual(buttonStyle({ background: '#001E62', color: '#FFFFFF' }), { background: '#001e62', color: '#ffffff' });
    assert.deepEqual(buttonStyle({ background: '#ffffff', color: '#767676' }), { background: '#ffffff', color: '#767676' });
    assert.equal(buttonStyle({ background: '#ffffff', color: '#777777' }), null);
    assert.equal(buttonStyle({ background: '#001E62', color: '#001E63' }), null);
  });

  it('drops both when only one is set or either is malformed', () => {
    assert.equal(buttonStyle({ background: '#001E62' }), null);
    assert.equal(buttonStyle({ color: '#ffffff' }), null);
    assert.equal(buttonStyle({ background: '#001E62', color: '' }), null);
    assert.equal(buttonStyle({ background: 'navy', color: '#ffffff' }), null);
    assert.equal(buttonStyle({ background: '#001E62', color: 'white;position:fixed' }), null);
    assert.equal(buttonStyle({ background: { toString: () => '#000000' }, color: '#ffffff' }), null);
  });
});

describe('icon', () => {
  it('accepts a PNG, JPEG, or WebP data URL whose bytes match', () => {
    for (const ok of [PNG, JPEG, WEBP]) assert.equal(isButtonIcon(ok), true, ok.slice(0, 30));
  });

  it('refuses SVG, remote URLs, and anything that isn’t a base64 image data URL', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    for (const bad of [
      `data:image/svg+xml;base64,${svg}`,
      'data:image/svg+xml,<svg onload=alert(1)>',
      'https://cdn.example.com/logo.png',
      '//cdn.example.com/logo.png',
      '/logo.png',
      'javascript:alert(1)',
      `data:image/gif;base64,${b64([...Buffer.from('GIF89a'), 1, 0, 1, 0, 0, 0, 0, 0, 0, 0])}`,
      `data:text/html;base64,${b64(PNG_BYTES)}`,
      `data:image/png,${b64(PNG_BYTES)}`,
      `data:image/png;charset=utf-8;base64,${b64(PNG_BYTES)}`,
      `data:image/png;base64,${b64(PNG_BYTES)}" onerror="alert(1)`,
      `data:image/png;base64,${b64(PNG_BYTES)}\n`,
      ` ${PNG}`,
      'data:image/png;base64,',
      'data:image/png;base64,AAAA',
      '', null, undefined, 42, { src: PNG },
    ]) assert.equal(isButtonIcon(bad), false, String(bad).slice(0, 50));
  });

  it('refuses bytes that aren’t the declared type', () => {
    assert.equal(isButtonIcon(`data:image/png;base64,${svgAsBase64()}`), false);
    assert.equal(isButtonIcon(PNG.replace('image/png', 'image/jpeg')), false);
    assert.equal(isButtonIcon(JPEG.replace('image/jpeg', 'image/webp')), false);
    assert.equal(isButtonIcon(WEBP.replace('image/webp', 'image/png')), false);
  });

  it('caps the whole data URL at 20 KB', () => {
    assert.equal(ICON_MAX_LENGTH, 20480);
    const head = `data:image/png;base64,${b64(PNG_BYTES.slice(0, 18))}`; // 24 base64 chars, no padding
    const atCap = head + 'A'.repeat(ICON_MAX_LENGTH - head.length);
    assert.equal(atCap.length, ICON_MAX_LENGTH);
    assert.equal(isButtonIcon(atCap), true);
    assert.equal(isButtonIcon(`${atCap}A`), false);
    assert.equal(isButtonIcon(head + 'A'.repeat(400_000)), false);
  });
});

function svgAsBase64() {
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64');
}

describe('buttonStyle', () => {
  it('returns only what passed, and null when nothing did', () => {
    assert.deepEqual(buttonStyle({ background: '#001E62', color: '#ffffff', icon: PNG }), { background: '#001e62', color: '#ffffff', icon: PNG });
    assert.deepEqual(buttonStyle({ background: '#ffffff', color: '#fffffe', icon: PNG }), { icon: PNG });
    assert.deepEqual(buttonStyle({ background: '#001E62', color: '#ffffff', icon: 'https://x.example/i.png' }), { background: '#001e62', color: '#ffffff' });
    assert.deepEqual(buttonStyle({ background: '', color: '', icon: '' }), null);
    for (const nothing of [null, undefined, 'x', 7, [], {}]) assert.equal(buttonStyle(nothing), null);
  });

  it('carries nothing else through', () => {
    assert.deepEqual(buttonStyle({ background: '#000000', color: '#ffffff', css: 'position:fixed', href: 'https://x.example' }), { background: '#000000', color: '#ffffff' });
  });
});
