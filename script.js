const puppeteer = require('puppeteer');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const email = process.env.EMAIL;
const password = process.env.PASSWORD;
const screenshotFile = 'economist_screenshot.png';
const outputDir = __dirname;

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });

  const page = await browser.newPage();

  // Step 1: Navigate to login
  await page.goto(process.env.LINK, {
    waitUntil: 'networkidle2'
  });

  // Step 2: Login
  await page.waitForSelector('input[name="username"]');
  await page.type('input[name="username"]', email);

  await page.waitForSelector('input[name="password"]');
  await page.type('input[name="password"]', password);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('button[type="submit"]')
  ]);

  console.log('✅ Logged in successfully');

  // Step 3: Wait for redirection and load homepage
  console.log('⏳ Waiting for 8 seconds...');
  await new Promise(r => setTimeout(r, 8000));

  // Step 4: Handle consent popup inside iframe
  console.log('⏳ Looking for consent popup...');
  const frames = await page.frames();

  const consentFrame = frames.find(f =>
    f.url().includes('privacy') || f.name().includes('sp_message')
  );

  if (consentFrame) {
    try {
      await consentFrame.waitForSelector('button[title*="Accept all"], button[aria-label*="Accept all"]', { timeout: 5000 });
      const consentButton = await consentFrame.$('button[title*="Accept all"], button[aria-label*="Accept all"]');
      if (consentButton) {
        await consentButton.click();
        console.log('✅ Consent accepted via iframe');
        console.log('⏳ Waiting for HP to load fully')
        await new Promise(r => setTimeout(r, 20000));
      } else {
        console.log('⚠️ Consent button not found in iframe after wait');
      }
    } catch (err) {
      console.error('❌ Error clicking consent button:', err);
    }
  } else {
    console.log('⚠️ Consent iframe not found');
  }

  // Step 5: Scroll and screenshot
  const scrollStep = 500;
  const scrollDelay = 2000;

  await page.evaluate(async (step, delay) => {
    const totalHeight = document.body.scrollHeight;
    let scrollY = 0;

    while (scrollY < totalHeight) {
      window.scrollBy(0, step);
      scrollY += step;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }, scrollStep, scrollDelay);

  await new Promise(r => setTimeout(r, 5000));

  // Take screenshot
  await page.screenshot({ path: screenshotFile, fullPage: true });
  console.log('📸 Screenshot saved');

  await browser.close();

  // Generate PDF filename with your format
  const now = new Date(Date.now() + 3600000); // UTC + 1 hour
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toISOString().slice(11, 16).replace(':', '');
  const prefix = 'GRNW_Economist';
  const existing = fs.readdirSync(outputDir).filter(name =>
    name.startsWith(`${prefix}_${dateStr}`) && name.endsWith('.pdf')
  );
  const count = String(existing.length + 1).padStart(2, '0');
  const finalName = `${prefix}_${dateStr}_${timeStr}_${count}.pdf`;
  const finalPath = path.join(outputDir, finalName);

  console.log(`📝 Converting to PDF: ${finalName}`);

  // Convert PNG to PDF
  try {
    // Read the PNG file
    const pngImageBytes = fs.readFileSync(screenshotFile);
    
    // Create a new PDF document
    const pdfDoc = await PDFDocument.create();
    
    // Embed the PNG image
    const pngImage = await pdfDoc.embedPng(pngImageBytes);
    const pngDims = pngImage.scale(0.5); // Adjust scale as needed
    
    // Add a page with the image
    const pdfPage = pdfDoc.addPage([pngDims.width, pngDims.height]);
    pdfPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pngDims.width,
      height: pngDims.height,
    });
    
    // Save the PDF
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(finalPath, pdfBytes);
    
    // Verify PDF was created
    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 0) {
      console.log(`✅ PDF saved as ${finalName}`);
      console.log(`📊 File size: ${(fs.statSync(finalPath).size / 1024).toFixed(2)} KB`);
      
      // Clean up temp screenshot
      // fs.unlinkSync(screenshotFile);
      // console.log('🧹 Temp screenshot cleaned up');
    } else {
      console.error('❌ PDF creation failed');
    }
    
  } catch (error) {
    console.error('❌ Error converting PNG to PDF:', error.message);
  }
})();