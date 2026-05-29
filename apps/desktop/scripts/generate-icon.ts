import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const svgPath = path.resolve(__dirname, '../build/icon.svg');
const buildDir = path.resolve(__dirname, '../build');

async function generateIcon() {
  const svgBuffer = fs.readFileSync(svgPath);

  // 生成不同尺寸的 PNG
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers: Buffer[] = [];

  for (const size of sizes) {
    const pngBuffer = await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers.push(pngBuffer);

    // 保存单独的 PNG 文件
    fs.writeFileSync(path.join(buildDir, `icon-${size}.png`), pngBuffer);
    console.log(`Generated icon-${size}.png`);
  }

  // 创建 ICO 文件 (包含多种尺寸)
  const icoBuffer = createICO(pngBuffers, sizes);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
  console.log('Generated icon.ico');

  // 保存 256x256 PNG 作为应用图标
  fs.writeFileSync(path.join(buildDir, 'icon.png'), pngBuffers[5]);
  console.log('Generated icon.png');
}

function createICO(pngBuffers: Buffer[], sizes: number[]): Buffer {
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const directoryEntrySize = 16;
  const directorySize = numImages * directoryEntrySize;

  // 计算每个图像数据的偏移量
  let dataOffset = headerSize + directorySize;
  const dataOffsets: number[] = [];
  for (const buffer of pngBuffers) {
    dataOffsets.push(dataOffset);
    dataOffset += buffer.length;
  }

  // 创建 ICO 文件
  const icoBuffer = Buffer.alloc(headerSize + directorySize + pngBuffers.reduce((sum, buf) => sum + buf.length, 0));

  // 文件头
  icoBuffer.writeUInt16LE(0, 0);      // 保留
  icoBuffer.writeUInt16LE(1, 2);      // 类型：1 = ICO
  icoBuffer.writeUInt16LE(numImages, 4); // 图像数量

  // 图标目录
  let offset = headerSize;
  for (let i = 0; i < numImages; i++) {
    const size = sizes[i];
    icoBuffer.writeUInt8(size === 256 ? 0 : size, offset);      // 宽度
    icoBuffer.writeUInt8(size === 256 ? 0 : size, offset + 1);  // 高度
    icoBuffer.writeUInt8(0, offset + 2);                         // 调色板
    icoBuffer.writeUInt8(0, offset + 3);                         // 保留
    icoBuffer.writeUInt16LE(1, offset + 4);                      // 颜色平面
    icoBuffer.writeUInt16LE(32, offset + 6);                     // 位深度
    icoBuffer.writeUInt32LE(pngBuffers[i].length, offset + 8);   // 数据大小
    icoBuffer.writeUInt32LE(dataOffsets[i], offset + 12);        // 数据偏移
    offset += directoryEntrySize;
  }

  // 图像数据
  offset = headerSize + directorySize;
  for (const buffer of pngBuffers) {
    buffer.copy(icoBuffer, offset);
    offset += buffer.length;
  }

  return icoBuffer;
}

generateIcon().catch(console.error);
