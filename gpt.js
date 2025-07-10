const { chromium } = require('playwright');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const email = process.env.EMAIL;
const password = process.env.PASSWORD;
const screenshotFile = 'economist_screenshot.png';
const outputDir = __dirname;

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({
    viewport: null,
  });

  const page = await context.newPage();

  // Step 1: Go to login page
  await page.goto(process.env.LINK, { waitUntil: 'networkidle' });

  // Step 2: Fill and submit login form
  await page.fill('input[name="username"]', email);
  await page.fill('input[name="password"]', password);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('button[type="submit"]')
  ]);

  console.log('✅ Logged in successfully');

  // Step 3: Wait for homepage to load
  console.log('⏳ Waiting for 2 seconds...');
  await page.waitForTimeout(2000);

  // Step 4: Handle consent popup inside iframe
  console.log('⏳ Looking for consent iframe...');
  const consentFrame = page.frames().find(f =>
    f.url().includes('privacy') || f.name().includes('sp_message')
  );

  if (consentFrame) {
    try {
      const consentButton = await consentFrame.waitForSelector(
        'button[title*="Accept all"], button[aria-label*="Accept all"]',
        { timeout: 2000 }
      );
      await consentButton.click();
      console.log('✅ Consent accepted');
      console.log('⏳ Waiting for homepage to load after consent...');
      await page.waitForTimeout(2000);
    } catch (err) {
      console.error('❌ Error handling consent:', err);
    }
  } else {
    console.log('⚠️ Consent iframe not found');
  }

  // Step 5: Scroll down to trigger lazy loading
  const scrollStep = 500;
  const scrollDelay = 200;

  await page.evaluate(async ({ step, delay }) => {
    const delayMs = ms => new Promise(res => setTimeout(res, ms));
    let scrollY = 0;
    while (scrollY < document.body.scrollHeight) {
      window.scrollBy(0, step);
      scrollY += step;
      await delayMs(delay);
    }
  }, { step: scrollStep, delay: scrollDelay });

  // Step 6: Scroll back to top and wait
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(5000);

  // Step 7: Take screenshot
  await page.screenshot({ path: screenshotFile, fullPage: true });
  console.log('📸 Screenshot saved');

  await browser.close();

  // Step 8: Generate PDF filename
  const now = new Date(Date.now() + 3600000); // UTC+1
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

  try {
    const pngImageBytes = fs.readFileSync(screenshotFile);
    const pdfDoc = await PDFDocument.create();
    const pngImage = await pdfDoc.embedPng(pngImageBytes);
    const pngDims = pngImage.scale(0.5);

    const pdfPage = pdfDoc.addPage([pngDims.width, pngDims.height]);
    pdfPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pngDims.width,
      height: pngDims.height,
    });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(finalPath, pdfBytes);

    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 0) {
      console.log(`✅ PDF saved as ${finalName}`);
      console.log(`📊 File size: ${(fs.statSync(finalPath).size / 1024).toFixed(2)} KB`);
    } else {
      console.error('❌ PDF creation failed');
    }

  } catch (err) {
    console.error('❌ Error during PNG to PDF conversion:', err.message);
  }
})();