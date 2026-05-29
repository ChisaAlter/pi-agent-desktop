const { spawn } = require('child_process');

console.log('Testing Pi CLI spawn with --print mode...');

const proc = spawn('pi', ['--print'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true
});

let output = '';
let errorOutput = '';

proc.stdout.on('data', (data) => {
  const text = data.toString();
  console.log('STDOUT:', text);
  output += text;
});

proc.stderr.on('data', (data) => {
  const text = data.toString();
  console.error('STDERR:', text);
  errorOutput += text;
});

proc.on('close', (code) => {
  console.log('Process exited with code:', code);
  console.log('Total output length:', output.length);
  console.log('Total error length:', errorOutput.length);
});

proc.on('error', (error) => {
  console.error('Process error:', error.message);
});

// Send a test message
proc.stdin.write('Say hello in one word\n');
proc.stdin.end();