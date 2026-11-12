import { useEffect, useRef } from 'react'
import { startGame, stopGame } from '@/game/boot'

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const params = new URLSearchParams(window.location.search)
    const multiplayer = params.get("mp") === "1"
      ? {
          serverUrl: params.get("server") || "http://localhost:31337",
          playerName: params.get("name") || "Player",
          room: params.get("room") || undefined,
        }
      : undefined
    void startGame(canvas, multiplayer)
    return () => stopGame()
  }, [])

  return (
    <div id="game-root" dir="rtl">
      <canvas id="game-canvas" ref={canvasRef} />
      <div id="ui-overlay">
        <div id="hud" className="hud">
          <div className="top-bar">
            <div className="team-score ct"><span>فريقك</span><b id="player-rounds">0</b></div>
            <div className="round-clock"><small id="round-label">الجولة 1 / 3</small><strong id="timer">01:15</strong><span id="enemies-left">4 خصوم</span></div>
            <div className="team-score enemy"><b id="enemy-rounds">0</b><span>الخصم</span></div>
          </div>
          <div className="objective" id="objective">تصفية جميع الخصوم</div>
          <div className="credits-hud"><small>الرصيد</small><b id="credits">$800</b></div>
          <div className="health-panel">
            <div className="stat-icon">+</div><div><small>الصحة</small><strong id="health">100</strong></div>
            <div className="armor"><small>الدرع</small><b id="armor">0</b></div>
          </div>
          <div className="ammo-panel"><small id="weapon-name">AR-4</small><div><strong id="ammo">30</strong><span>/</span><b id="reserve">90</b></div><em id="reload-label"></em></div>
          <div id="killfeed" className="killfeed"></div>
          <div className="controls-hint">WASD حركة <i>•</i> R تلقيم <i>•</i> 1/2 سلاح <i>•</i> Shift ركض</div>
        </div>

        <div id="crosshair" className="crosshair"><i></i><i></i><i></i><i></i><b></b></div>
        <div id="hitmarker" className="hitmarker">×</div>
        <div id="damage-flash" className="damage-flash"></div>
        <div id="scope" className="scope"><div></div></div>
        <div id="round-banner" className="round-banner"><small></small><strong></strong><span></span></div>

        <section id="title-screen" className="screen title-screen active">
          <div className="title-content">
            <div className="eyebrow"><span></span> عملية تكتيكية فردية</div>
            <h1><span>SAND</span>LINE</h1>
            <h2>بروتوكول خط الرمل</h2>
            <p>ادخل مجمعًا صحراويًا محصنًا. ثلاث جولات، موارد محدودة، وخصم لا يقف في مكانه.</p>
            <div className="feature-row"><span>تصويب تكتيكي</span><span>اقتصاد جولات</span><span>3 أنواع خصوم</span></div>
            <button id="start-btn" className="primary-btn" type="button"><span>ابدأ المهمة</span><kbd>SPACE</kbd></button>
            <small className="start-note">انقر داخل اللعبة لتثبيت الماوس • ESC للإيقاف</small>
          </div>
          <div className="title-side">
            <div className="mission-card"><small>الموقع 07</small><strong>مجمع السيليكا</strong><span>الصحراء الغربية</span><div className="map-line"></div><dl><div><dt>المهمة</dt><dd>تصفية</dd></div><div><dt>الجولات</dt><dd>3</dd></div><div><dt>الحالة</dt><dd className="online">جاهز</dd></div></dl></div>
          </div>
          <div className="title-footer"><span>WASD</span> للحركة <span>الماوس</span> للتصويب <span>زر أيسر</span> لإطلاق النار <span>زر أيمن</span> للمنظار</div>
        </section>

        <section id="buy-screen" className="screen buy-screen">
          <div className="modal wide">
            <div className="modal-head"><div><small id="buy-kicker">مرحلة التجهيز</small><h2 id="buy-title">استعد للجولة التالية</h2><p id="round-result">اختر معداتك بحكمة.</p></div><div className="buy-balance"><small>الرصيد المتاح</small><strong id="buy-credits">$800</strong></div></div>
            <div className="buy-grid">
              <button className="buy-card" data-buy="rifle" type="button"><span className="slot">01</span><div className="weapon-icon rifle-icon"></div><h3>AR-4</h3><p>بندقية آلية متوازنة للمدى القريب والمتوسط.</p><footer><b>مملوك</b><em>تجهيز</em></footer></button>
              <button className="buy-card" data-buy="sniper" type="button"><span className="slot">02</span><div className="weapon-icon sniper-icon"></div><h3>LR-8</h3><p>طلقة حاسمة ومنظار دقيق. بطيئة عند التحرك.</p><footer><b>$1,200</b><em>شراء وتجهيز</em></footer></button>
              <button className="buy-card armor-card" data-buy="armor" type="button"><span className="slot">+</span><div className="armor-icon">◆</div><h3>درع تكتيكي</h3><p>يمتص 50٪ من الضرر حتى نفاد قيمته.</p><footer><b>$650</b><em>+50 درع</em></footer></button>
            </div>
            <div className="buy-actions"><span id="buy-tip">القضاء على خصم يمنحك $150</span><button id="next-round-btn" className="primary-btn" type="button">ابدأ الجولة <kbd>SPACE</kbd></button></div>
          </div>
        </section>

        <section id="pause-screen" className="screen pause-screen">
          <div className="modal compact"><small>المهمة متوقفة</small><h2>PAUSED</h2><p>خذ نفسًا. الجولة لن تتقدم حتى تعود.</p><button id="resume-btn" className="primary-btn" type="button">متابعة</button><button id="restart-btn" className="secondary-btn" type="button">إعادة المهمة</button></div>
        </section>

        <section id="end-screen" className="screen end-screen">
          <div className="modal compact"><div id="end-badge" className="end-badge">المهمة انتهت</div><h2 id="end-title">انتصار</h2><p id="end-subtitle">تم تأمين المجمع.</p><div className="match-stats"><div><strong id="stat-kills">0</strong><small>إصابات قاتلة</small></div><div><strong id="stat-accuracy">0%</strong><small>الدقة</small></div><div><strong id="stat-rounds">0</strong><small>جولات فائزة</small></div></div><button id="end-restart-btn" className="primary-btn" type="button">مهمة جديدة</button></div>
        </section>

        <button id="mute-btn" className="mute-btn" type="button" aria-label="كتم الصوت">الصوت: يعمل</button>
        <div className="desktop-only">التجربة مصممة للوحة المفاتيح والماوس</div>
      </div>
    </div>
  )
}
