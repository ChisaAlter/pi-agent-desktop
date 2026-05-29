const { spawn } = require('child_process');

console.log('=== Testing Pi CLI spawn with command string ===\n');

const provider = 'mimo';
const model = 'mimo-v2.5-pro';
const args = ['--provider', provider, '--model', model, '--print'];

// 构建命令字符串
const command = `pi ${args.map(a => `"${a}"`).join(' ')}`;
console.log('Command:', command);

const proc = spawn(command, [], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true
});

let output = '';
let errorOutput = '';

proc.stdout.on('data', (data) => {
  const text = data.toString();
  console.log('STDOUT chunk:', JSON.stringify(text));
  output += text;
});

proc.stderr.on('data', (data) => {
  const text = data.toString();
  console.error('STDERR:', text);
  errorOutput += text;
});

proc.on('close', (code) => {
  console.log('\n=== Process completed ===');
  console.log('Exit code:', code);
  console.log('Total output:', output);
  console.log('Output length:', output.length);
});

proc.on('error', (error) => {
  console.error('Process error:', error.message);
});

// Send test message
console.log('\nSending test message...');
proc.stdin.write('Say "test successful" in one line\n');
proc.stdin.end();