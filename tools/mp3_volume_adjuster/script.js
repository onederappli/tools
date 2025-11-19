document.addEventListener('DOMContentLoaded', async () => {
    
    // --- 1. Wavesurfer設定 ---
    const wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#4ade80',
        progressColor: '#22c55e',
        cursorColor: '#ffffff',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 450,
        normalize: false,
        backend: 'WebAudio',
        dragToSeek: true,
    });

    // --- HTML要素 ---
    const fileInput = document.getElementById('fileInput');
    const playBtn = document.getElementById('playBtn');
    const volumeSlider = document.getElementById('volumeSlider');
    const volValue = document.getElementById('volValue');
    const timeDisplay = document.getElementById('timeDisplay');
    const convertButton = document.getElementById('convertButton');
    const statusMessage = document.getElementById('statusMessage');
    const progressBar = document.getElementById('progress');
    const waveformElement = document.getElementById('waveform');
    const yAxisCanvas = document.getElementById('y-axis');

    // --- 2. 目盛り(Y軸グリッド) ---
    function drawGrid() {
        const width = yAxisCanvas.parentElement.offsetWidth;
        const height = yAxisCanvas.parentElement.offsetHeight;
        yAxisCanvas.width = width;
        yAxisCanvas.height = height;

        const ctx = yAxisCanvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        ctx.font = '11px monospace';
        ctx.lineWidth = 1;

        const center = height / 2;
        const dbToRatio = (db) => Math.pow(10, db / 20);

        const drawLine = (ratio, label) => {
            const yTop = center - (center * ratio);
            const yBottom = center + (center * ratio);

            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; 
            ctx.moveTo(0, yTop); ctx.lineTo(width, yTop);
            ctx.moveTo(0, yBottom); ctx.lineTo(width, yBottom);
            ctx.stroke();

            if (label) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.textBaseline = 'top';
                ctx.fillText(label, 5, yTop + 2);
                ctx.textBaseline = 'bottom';
                ctx.fillText(label, 5, yBottom - 2);
            }
        };

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.moveTo(0, center); ctx.lineTo(width, center);
        ctx.stroke();
        
        drawLine(dbToRatio(-5), "-5dB");
        drawLine(dbToRatio(-10), "-10dB");
        drawLine(dbToRatio(-15), "-15dB");
    }
    
    drawGrid();
    window.addEventListener('resize', drawGrid);


    // --- 4. スライダー操作 ---
    const updateVolumeAndWaveform = () => {
        const db = parseFloat(volumeSlider.value);
        volValue.textContent = (db > 0 ? "+" : "") + db.toFixed(1) + " dB";
        const gain = Math.pow(10, db / 20); 
        wavesurfer.setVolume(gain);
        const visualScale = Math.max(0, gain); 
        waveformElement.style.transform = `scaleY(${visualScale})`;
    };
    volumeSlider.addEventListener('input', updateVolumeAndWaveform);


    // --- 5. FFmpeg関連 ---
    const FFmpegLib = window.FFmpeg || FFmpeg;
    let ffmpeg = null;

    if (FFmpegLib) {
        const { createFFmpeg, fetchFile } = FFmpegLib;
        ffmpeg = createFFmpeg({ log: true, corePath: 'ffmpeg-core.js' });
        loadFFmpeg();
    }

    async function loadFFmpeg() {
        if (!ffmpeg.isLoaded()) {
            statusMessage.textContent = 'システム起動中...';
            try {
                await ffmpeg.load();
                statusMessage.textContent = '';
            } catch(e) {
                statusMessage.textContent = 'FFmpeg Load Error';
            }
        }
    }

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            statusMessage.textContent = "解析中...";
            statusMessage.style.color = "#fbbf24";
            wavesurfer.load(url);
            wavesurfer.once('ready', () => {
                playBtn.textContent = "PLAY";
                statusMessage.textContent = "準備完了";
                volumeSlider.value = 0;
                updateVolumeAndWaveform();
            });
        }
    });

    playBtn.addEventListener('click', () => wavesurfer.playPause());
    wavesurfer.on('play', () => { playBtn.textContent = "PAUSE"; });
    wavesurfer.on('pause', () => { playBtn.textContent = "PLAY"; });
    wavesurfer.on('audioprocess', () => { timeDisplay.textContent = formatTime(wavesurfer.getCurrentTime()); });
    wavesurfer.on('seeking', () => { timeDisplay.textContent = formatTime(wavesurfer.getCurrentTime()); });

    convertButton.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) return alert('ファイルを選択してください');

        wavesurfer.pause();
        const dbValue = volumeSlider.value;
        statusMessage.textContent = '変換中...';
        progressBar.style.display = 'block';
        progressBar.style.width = '0%';
        convertButton.disabled = true;

        try {
            const { fetchFile } = FFmpegLib;
            ffmpeg.setProgress(({ ratio }) => { progressBar.style.width = `${Math.round(ratio * 100)}%`; });

            await ffmpeg.FS('writeFile', 'input.mp3', await fetchFile(file));
            await ffmpeg.run('-i', 'input.mp3', '-af', `volume=${dbValue}dB`, '-c:a', 'libmp3lame', 'output.mp3');

            const data = ffmpeg.FS('readFile', 'output.mp3');
            const url = URL.createObjectURL(new Blob([data.buffer], { type: 'audio/mp3' }));
            
            const a = document.createElement('a');
            a.href = url;

            // --- ▼ ファイル名変更箇所 ▼ ---
            // 元のファイル名から拡張子を除去し、_adjusted.mp3 を付与
            // 例: song.mp3 -> song_adjusted.mp3
            const originalName = file.name.replace(/\.[^/.]+$/, "");
            a.download = `${originalName}_adjusted.mp3`;
            // ----------------------------

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            statusMessage.textContent = '完了！保存しました';
            progressBar.style.width = '100%';
        } catch (error) {
            console.error(error);
            statusMessage.textContent = 'エラーが発生しました';
        } finally {
            convertButton.disabled = false;
        }
    });

    function formatTime(seconds) {
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 10);
        return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${ms}`;
    }
});