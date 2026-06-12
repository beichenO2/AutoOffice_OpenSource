import { describe, expect, it } from 'vitest';
import { renderTemplateString } from '../src/template/engine.js';

describe('template engine', () => {
  it('renders handlebars with data', async () => {
    const out = await renderTemplateString('<p>{{title}}</p>', { title: '季度总结' });
    expect(out).toBe('<p>季度总结</p>');
  });

  it('supports eq helper', async () => {
    const out = await renderTemplateString('{{#if (eq mode "brief")}}短{{else}}长{{/if}}', {
      mode: 'brief',
    });
    expect(out).toBe('短');
  });
});
