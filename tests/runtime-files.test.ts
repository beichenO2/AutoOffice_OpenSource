import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FORBIDDEN = /(^|\s)(nohup|disown|pkill|killall|kill|lsof)(\s|$)|PID_FILE|setsid|[^&]&\s*$/m;

describe('runtime governance files', () => {
  it('defines an executable canonical foreground launcher', () => {
    const file = path.join(ROOT, 'Start', 'start.sh');
    expect(fs.statSync(file).mode & 0o111).not.toBe(0);
    const source = fs.readFileSync(file, 'utf8');
    expect(source).toContain('claim_port "autooffice" "AutoOffice" 3900');
    expect(source).toContain('POLAR_RUNTIME_MANAGED=1');
    expect(source).toContain('exec "$NODE_BIN" dist/cli.js serve -p "$PORT"');
    expect(source).not.toMatch(FORBIDDEN);
  });

  it('converts stop and status into exact PolarProcess clients', () => {
    const stop = fs.readFileSync(path.join(ROOT, 'Start', 'stop.sh'), 'utf8');
    expect(stop).toContain('/api/services/autooffice/stop');
    expect(stop).not.toMatch(FORBIDDEN);
    expect(stop).not.toMatch(/dist\/cli\.js/);

    const status = fs.readFileSync(path.join(ROOT, 'Start', 'status.sh'), 'utf8');
    expect(status).toContain('/api/services/autooffice');
    expect(status).toContain('http://127.0.0.1:3900/health');
    expect(status).not.toMatch(/lsof|PID_FILE|Start\/\.pid/);
  });

  it('registers three phases without lifecycle calls or cron mutations', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', 'register-runtime.sh'), 'utf8');
    expect(source).toContain('MODE=${1:-prepare}');
    expect(source).toContain('prepare|cutover|finalize');
    expect(source).toContain('node dist/cli.js serve -p 3900');
    expect(source).toContain('bash Start/start.sh');
    expect(source).toContain('http://127.0.0.1:3900/health');
    expect(source).toContain('id: "autooffice"');
    expect(source).not.toMatch(/autooffice-(auto-evolve|sota-radar)/);
    expect(source).not.toMatch(/api\/services\/[^"']+\/(start|stop|restart)/);
  });

  it('keeps every Start script free of background and direct signal control', () => {
    const startDir = path.join(ROOT, 'Start');
    for (const name of fs.readdirSync(startDir).filter((file) => file.endsWith('.sh'))) {
      expect(fs.readFileSync(path.join(startDir, name), 'utf8'), name).not.toMatch(FORBIDDEN);
    }
  });

  it('declares R7 and canonical service management across SSoT and skills', () => {
    const polaris = JSON.parse(fs.readFileSync(path.join(ROOT, 'polaris.json'), 'utf8'));
    const runtime = polaris.requirements.find((item: { id: string }) => item.id === 'R7');
    expect(runtime).toMatchObject({ feature: 'runtime_governance' });
    expect(['in-progress', 'tested', 'done']).toContain(runtime.status);
    expect(polaris.service_management).toMatchObject({
      service_id: 'autooffice',
      start_command: 'bash Start/start.sh',
      restart_command: 'bash Start/start.sh',
      health_endpoint: 'http://127.0.0.1:3900/health',
      preferred_port: 3900,
      auto_start: true,
      process_mode: 'foreground_command',
    });

    const skillFiles = [
      'PolarSkills/autooffice-ops/SKILL.md',
      'PolarSkills/autooffice-ops/DEPLOY.md',
      'PolarSkills/autooffice-ops/TROUBLESHOOT.md',
    ];
    for (const file of skillFiles) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(source, file).toContain('PolarProcess');
      expect(source, file).toContain('PolarPort');
      expect(source, file).not.toContain('node dist/cli.js serve --port 3900');
    }

    const capability = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'coordination/capabilities/autooffice.report_gen.json'),
      'utf8',
    ));
    expect(capability.entry_points.http_server).toBe('PolarProcess service autooffice');
  });
});
