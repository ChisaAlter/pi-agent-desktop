const { spawn } = require('child_process');
const EventEmitter = require('events');

// 模拟 Electron IPC
class MockIPC extends EventEmitter {
  send(channel, data) {
    console.log(`[IPC] ${channel}:`, data.type || data);
    this.emit('event', data);
  }
}

const ipc = new MockIPC();
let mainWindow = { webContents: ipc };

console.log('=== Testing Full Pi CLI Flow ===\n');

// 模拟主进程的 pi:prompt handler
function handlePrompt(message) {
  const provider = 'mimo';
  const model = 'mimo-v2.5-pro';
  
  console.log('[Handler] Processing message:', message.substring(0, 50) + '...');
  
  return new Promise((resolve, reject) => {
    try {
      const args = ['--provider', provider, '--model', model, '--print'];
      const command = `pi ${args.map(a => `"${a}"`).join(' ')}`;
      
      console.log('[Handler] Spawning:', command);
      
      const proc = spawn(command, [], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      let fullResponse = '';

      // 发送 text_start
      mainWindow.webContents.send('pi:event', { type: 'text_start' });

      // 标记是否已经发送了 turn_end
      let turnEnded = false;
      const sendTurnEnd = () => {
        if (!turnEnded) {
          turnEnded = true;
          mainWindow.webContents.send('pi:event', { type: 'turn_end' });
        }
      };

      proc.stdout?.on('data', (data) => {
        const text = data.toString();
        console.log('[Handler] stdout chunk, length:', text.length);
        fullResponse += text;
        mainWindow.webContents.send('pi:event', {
          type: 'text_delta',
          text: text
        });
      });

      proc.stderr?.on('data', (data) => {
        console.error('[Handler] stderr:', data.toString().substring(0, 100));
      });

      proc.on('close', (code) => {
        console.log('[Handler] Process closed, code:', code);
        setTimeout(sendTurnEnd, 100);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Pi exited with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        console.error('[Handler] Process error:', error.message);
        mainWindow.webContents.send('pi:event', {
          type: 'error',
          message: error.message
        });
        sendTurnEnd();
        reject(error);
      });

      // 发送消息
      proc.stdin?.write(message + '\n');
      proc.stdin?.end();
    } catch (error) {
      reject(error);
    }
  });
}

// 模拟渲染进程的事件监听
let contentRef = '';
let currentMessageId = null;

ipc.on('event', (event) => {
  console.log('[Renderer] Event received:', event.type);
  
  switch (event.type) {
    case 'text_start':
      contentRef = '';
      console.log('[Renderer] Content reset');
      break;
      
    case 'text_delta':
      contentRef += event.text || '';
      console.log('[Renderer] Content updated, length:', contentRef.length);
      break;
      
    case 'turn_end':
      console.log('[Renderer] Turn ended, final content:', contentRef);
      break;
      
    case 'error':
      console.error('[Renderer] Error:', event.message);
      break;
  }
});

// 运行测试
async function runTest() {
  try {
    console.log('Sending test message...\n');
    await handlePrompt('Say "Hello from Pi" and nothing else');
    console.log('\n=== Test completed ===');
    console.log('Final response:', contentRef);
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

runTest();