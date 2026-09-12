// ==UserScript==
// @name         B站键盘左右键按住后上下键调音量
// @namespace    http://tampermonkey.net/
// @version      1.3.1
// @description  按住键盘左/右方向键不放，再按上下箭头调节音量，每次增减10%，选集切换视频自动适配
// @author       clotten
// @match        *://*.bilibili.com/video/*
// @match        *://*.bilibili.com/bangumi/*
// @match        *://*.bilibili.com/cheese/*
// @grant        none
// ==/UserScript==
(function fixBilibiliKeyHoldVolume() {
    'use strict';
    let observer = null;
    let isHoldLeftKey = false;
    let isHoldRightKey = false;
    let volumeKeyHandler = null;
    let hasInitPlayer = false; // 新增：标记已经初始化过播放器
    let debounceTimer = null;  // 防抖定时器

    // 样式只注入一次
    const styleId = 'bili-volume-copy-style';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
.bpx-player-volume-hint-copy{
    -webkit-box-align:center;-ms-flex-align:center;align-items:center;
    background:hsla(0,0%,100%,.8);
    border-radius:4px;
    color:#000;
    display:-webkit-box;display:-ms-flexbox;display:flex;
    font-size:20px;
    height:32px;
    left:50%;
    min-width:84px;
    padding:8px;
    position:absolute;
    top:50%;
    -webkit-transform:translate(-50%,-50%);
    transform:translate(-50%,-50%);
    z-index:77;
    opacity:0;
    pointer-events:none;
    -webkit-transition:opacity .25s ease;
    transition:opacity .25s ease;
}
.bpx-player-volume-hint-icon-copy{
    -webkit-box-flex:0;-ms-flex:none;flex:none;
    height:34px;width:34px;
}
.bpx-player-volume-hint-icon-copy svg{width:100%;height:100%}
.bpx-player-volume-hint-text-copy{
    -webkit-box-flex:1;-ms-flex:1;flex:1;
    line-height:34px;
    padding:0 2px;
    text-align:center;
}
`;
        document.head.appendChild(style);
    }

    function showVolumeToast(volPercent) {
        let hintDom = document.querySelector('.bpx-player-volume-hint-copy');
        const playerWrap = document.querySelector('.bpx-player-video-wrap');
        if (!playerWrap) return;
        if (!hintDom) {
            hintDom = document.createElement('div');
            hintDom.className = 'bpx-player-volume-hint-copy';
            hintDom.innerHTML = `
<span class="bpx-player-volume-hint-icon-copy">
<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" data-pointer="none" style="enable-background:new 0 0 22 22" viewBox="0 0 22 22"><path d="M10.188 4.65 6 8H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1l4.188 3.35a.5.5 0 0 0 .812-.39V5.04a.498.498 0 0 0-.812-.39zM14.446 3.778a1 1 0 0 0-.862 1.804 6.002 6.002 0 0 1-.007 10.838 1 1 0 0 0 .86 1.806A8.001 8.001 0 0 0 19 11a8.001 8.001 0 0 0-4.554-7.222z"></path><path d="M15 11a3.998 3.998 0 0 0-2-3.465v6.93A3.998 3.998 0 0 0 15 11z"></path></svg>
<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" data-pointer="none" style="display: none;" viewBox="0 0 22 22"><path d="M15 11a3.998 3.998 0 0 0-2-3.465v2.636l1.865 1.865A4.02 4.02 0 0 0 15 11z"></path><path d="M13.583 5.583A5.998 5.998 0 0 1 17 11a6 6 0 0 1-.585 2.587l1.477 1.477a8.001 8.001 0 0 0-3.446-11.286 1 1 0 0 0-.863 1.805zM18.778 18.778l-2.121-2.121-1.414-1.414-1.415-1.415L13 13l-2-2-3.889-3.889-3.889-3.889a.999.999 0 1 0-1.414 1.414L5.172 8H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1l4.188 3.35a.5.5 0 0 0 .812-.39v-3.131l2.587 2.587-.01.005a1 1 0 0 0 .86 1.806c.215-.102.424-.214.627-.333l2.3 2.3a1.001 1.001 0 0 0 1.414-1.416zM11 5.04a.5.5 0 0 0-.813-.39L8.682 5.854 11 8.172V5.04z"></path></svg>
</span>
<span class="bpx-player-volume-hint-text-copy">75%</span>
`;
            playerWrap.appendChild(hintDom);
        }
        const textSpan = hintDom.querySelector('.bpx-player-volume-hint-text-copy');
        const svgNormal = hintDom.querySelector('.bpx-player-volume-hint-icon-copy svg:nth-child(1)');
        const svgMute = hintDom.querySelector('.bpx-player-volume-hint-icon-copy svg:nth-child(2)');
        textSpan.textContent = `${volPercent}%`;
        if (volPercent <= 0) {
            svgNormal.style.display = 'none';
            svgMute.style.display = 'inline-block';
        } else {
            svgNormal.style.display = 'inline-block';
            svgMute.style.display = 'none';
        }
        hintDom.style.opacity = '1';
        clearTimeout(hintDom._timer);
        hintDom._timer = setTimeout(() => {
            hintDom.style.opacity = '0';
        }, 800);
    }

    function initPlayer() {
        const playerWrap = document.querySelector('.bpx-player-video-wrap');
        if (!playerWrap) {
            hasInitPlayer = false;
            return false;
        }
        // 如果已经初始化，直接跳过，避免刷屏
        if(hasInitPlayer) return false;

        // 清理旧弹窗DOM
        const oldHint = document.querySelector('.bpx-player-volume-hint-copy');
        if (oldHint) oldHint.remove();
        // 移除旧的音量按键监听，防止多次绑定
        if (volumeKeyHandler) {
            window.removeEventListener('keydown', volumeKeyHandler, true);
        }
        isHoldLeftKey = false;
        isHoldRightKey = false;

        // 监听左右箭头按下，记录按住状态
        document.addEventListener('keydown', (e) => {
            const tag = document.activeElement.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (e.code === 'ArrowLeft') isHoldLeftKey = true;
            if (e.code === 'ArrowRight') isHoldRightKey = true;
        }, true);
        document.addEventListener('keyup', (e) => {
            if (e.code === 'ArrowLeft') isHoldLeftKey = false;
            if (e.code === 'ArrowRight') isHoldRightKey = false;
        }, true);

        // 上下箭头处理音量逻辑
        volumeKeyHandler = function (e) {
            const tag = document.activeElement.tagName;
            if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (isHoldLeftKey || isHoldRightKey) {
                e.stopImmediatePropagation();
                e.preventDefault();
                const video = document.querySelector('video');
                if (!video) return;
                if (e.code === 'ArrowUp') {
                    video.volume = Math.min(1, video.volume + 0.1);
                } else {
                    video.volume = Math.max(0, video.volume - 0.1);
                }
                const volPercent = Math.round(video.volume * 100);
                showVolumeToast(volPercent);
            }
        };
        window.addEventListener('keydown', volumeKeyHandler, true);
        hasInitPlayer = true;
        console.log("✅播放器初始化完成，选集切换后自动生效");
        return true;
    }

    // 监听页面DOM，防抖，减少频繁触发
    function watchPlayerChange() {
        if (observer) observer.disconnect();
        observer = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(()=>{
                // 检测播放器容器是否消失（切换选集时容器销毁）
                const wrap = document.querySelector('.bpx-player-video-wrap');
                if(!wrap){
                    hasInitPlayer = false;
                }
                initPlayer();
            },150); // 150ms防抖，过滤大量高频DOM变动
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    watchPlayerChange();
})();
