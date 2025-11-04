document.addEventListener('DOMContentLoaded', () => {
    // グローバルスコープから FFmpeg オブジェクトを取得
    const { FFmpeg } = FFmpegWASM;
    let ffmpeg = null;

    // HTML要素の取得
    const fileInput = document.getElementById('fileInput');
    const convertButton = document.getElementById('convertButton');
    const statusMessage = document.getElementById('statusMessage');
    const logOutput = document.getElementById('logOutput');
    const outputVideo = document.getElementById('outputVideo');
    const progressDiv = document.getElementById('progress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    let inputFile = null;
    let totalDuration = 0; // 動画の総時間（進捗計算用）

    // 1. FFmpegインスタンスの初期ロード処理
    const loadFFmpeg = async () => {
        if (ffmpeg) return ffmpeg; // 既にロード済みなら何もしない
        
        statusMessage.textContent = 'FFmpegコアをロード中... (初回は時間がかかります)';
        convertButton.disabled = true;
        logOutput.style.display = 'block';
        logOutput.textContent = "ロード開始...\n";
        
        ffmpeg = new FFmpeg();

        // ログ出力を設定
        ffmpeg.on('log', ({ type, message }) => {
            logOutput.textContent += `[${type}] ${message}\n`;
            logOutput.scrollTop = logOutput.scrollHeight; // 自動スクロール
        });

        // 進捗計算の設定
        ffmpeg.on('progress', ({ progress, time }) => {
            // timeは処理済みの時間(マイクロ秒)
            if (totalDuration > 0) {
                // 進捗を計算
                const percentage = Math.round((time / 1000000 / totalDuration) * 100);
                if (percentage > 0 && percentage <= 100) {
                    progressBar.value = percentage;
                    progressText.textContent = `${percentage}%`;
                }
            }
        });

        // コアファイルのロード
        try {
            // FFmpeg.wasm v0.12.x の標準的なロード方法
            await ffmpeg.load({
                coreURL: "ffmpeg-core.js",
            });
            statusMessage.textContent = '準備完了。ファイルを選択してください。';
            logOutput.textContent += "ロード完了。\n";
            convertButton.disabled = false;
        } catch (error) {
            statusMessage.textContent = 'FFmpegのロードに失敗しました。';
            logOutput.textContent += `ロードエラー: ${error}\n`;
            console.error(error);
        }
        return ffmpeg;
    };

    // ページロード時にFFmpegをロード開始
    loadFFmpeg();

    // ファイルが選択された時の処理
    fileInput.addEventListener('change', (event) => {
        inputFile = event.target.files[0];
        if (inputFile) {
            statusMessage.textContent = `ファイル選択中: ${inputFile.name}`;
            // 各種表示をリセット
            outputVideo.style.display = 'none';
            logOutput.textContent = '';
            logOutput.style.display = 'none';
            progressDiv.style.display = 'none';
            progressBar.value = 0;
            progressText.textContent = '0%';
        }
    });

    // 「変換実行」ボタンが押された時の処理
    convertButton.addEventListener('click', async () => {
        if (!inputFile) {
            alert('まずMOVファイルを選択してください。');
            return;
        }
        if (!ffmpeg || !ffmpeg.loaded) {
            await loadFFmpeg(); // もしロードされていなければ、再度ロードを試みる
            if (!ffmpeg.loaded) {
                alert('FFmpegがロードされていません。リロードしてください。');
                return;
            }
        }

        // 変換中はボタンを無効化し、UIをリセット
        convertButton.disabled = true;
        statusMessage.textContent = '変換準備中...';
        logOutput.textContent = '';
        logOutput.style.display = 'block';
        progressDiv.style.display = 'block';
        progressBar.value = 0;
        progressText.textContent = '0%';
        outputVideo.style.display = 'none';

        try {
            // ★★★ 修正点 1: 入力ファイル名を input.[拡張子] に変更 ★★★
            // (input.mov固定だと、MP4 -> MP4変換などで "copy" が失敗するため)
            const originalExtension = inputFile.name.slice(inputFile.name.lastIndexOf('.'));
            const inputFilename = "input" + (originalExtension || ".tmp"); // 例: input.mov
            const outputFilename = "output.mp4";

            // 1. ファイルをFFmpegの仮想ファイルシステムに書き込む
            statusMessage.textContent = 'ファイルをメモリに書き込み中...';
            
            const arrayBuffer = await inputFile.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);
            
            await ffmpeg.writeFile(inputFilename, data);

            // 2. [オプション] 動画の総時間(秒)を取得して進捗表示の精度を上げる
            totalDuration = 0;
            logOutput.textContent += "動画の長さを解析中...\n";
            try {
                // ffprobeの代わりにffmpegの-iオプションのログからdurationを抽出
                let durationLogs = "";
                const durationLogger = ({ type, message }) => {
                    if (type === 'stderr') {
                        durationLogs += message + '\n';
                        // "Duration: 00:00:10.50," のような行を探す
                        const match = message.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
                        if (match) {
                            const [_, hours, minutes, seconds, milliseconds] = match;
                            totalDuration = (parseInt(hours) * 3600) + (parseInt(minutes) * 60) + parseInt(seconds) + (parseInt(milliseconds) / 100);
                            logOutput.textContent += `動画の長さ: ${totalDuration} 秒\n`;
                        }
                    }
                };
                ffmpeg.on('log', durationLogger);
                await ffmpeg.exec(['-i', inputFilename]); // -i だけで実行
                ffmpeg.off('log', durationLogger); // このハンドラを解除
            } catch (e) {
                if (totalDuration === 0) {
                     logOutput.textContent += "動画の長さの自動取得に失敗。進捗表示が不正確になる可能性があります。\n";
                }
            }

            // 3. 変換実行
            statusMessage.textContent = '変換実行中... (PCの性能と動画サイズに依存します)';
            
            /*
             * === 変換オプション ===
             * * [A] 高速（コンテナ入れ替え）: `-c copy`
             * MOV内の動画/音声コーデックがMP4互換(H.264/AAC等)の場合に使えます。
             * iPhoneの動画は多くがこれに該当し、非常に高速です。
             * * [B] 再エンコード（低速・高負荷）: オプションなし
             * コーデックがMP4非互換の場合。確実ですがブラウザでは非常に遅くなります。
             * * ★ ここでは [A] を採用します。もし変換に失敗する場合は [B] を試してください。
             */
            
            const command = ['-i', inputFilename, '-c', 'copy', outputFilename];
            // const command = ['-i', inputFilename, outputFilename]; // [B] 再エンコードする場合

            await ffmpeg.exec(command);
            
            progressBar.value = 100;
            progressText.textContent = '100%';
            statusMessage.textContent = '変換完了。ファイルを読み込み中...';
            
            // 4. 変換されたファイルを読み出す
            const outputData = await ffmpeg.readFile(outputFilename);
            
            // 5. ビデオタグで表示
            const blob = new Blob([outputData.buffer], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            outputVideo.src = url;
            outputVideo.style.display = 'block';

            // ★★★ 修正点 2: ここから自動ダウンロード処理を追加 ★★★
            
            // 元のファイル名から拡張子を除いた部分を取得
            const originalName = inputFile.name; // 例: "myvideo.mov"
            let baseName = originalName;
            const lastDotIndex = originalName.lastIndexOf('.');
            
            // '.' が存在し、かつ最初の一文字ではない場合 (例: "test.mov")
            if (lastDotIndex > 0) { 
                baseName = originalName.slice(0, lastDotIndex); // 例: "myvideo"
            }
            // 拡張子なし(例: "myvideo")や隠しファイル(例: ".config")の場合はそのまま baseName を使う
            
            const downloadFilename = baseName + ".mp4"; // 例: "myvideo.mp4"

            // ダウンロード用のリンク(<a>タグ)を動的に作成
            const link = document.createElement('a');
            link.href = url;
            link.download = downloadFilename;
            
            // リンクをDOMに追加してクリックイベントを発火（見えないように）
            document.body.appendChild(link);
            link.click();
            
            // 不要になったリンクをDOMから削除
            document.body.removeChild(link);

            // ★★★ 自動ダウンロード処理ここまで ★★★

            statusMessage.textContent = '変換に成功しました！';

        } catch (error) {
            statusMessage.textContent = '変換中にエラーが発生しました。';
            // エラーがTypeErrorだった場合、ヒントメッセージが不適切なので修正
            if (error instanceof TypeError) {
                 logOutput.textContent += `\n\n[ERROR] ${error}\n`;
                 logOutput.textContent += "スクリプトの呼び出しエラーが発生しました。\n";
            } else {
                 logOutput.textContent += `\n\n[ERROR] ${error}\n`;
                 logOutput.textContent += "ヒント: [-c copy] に失敗しました。コーデックがMP4非互換かもしれません。\nJavaScript内の 'command' 変数を変更して再エンコードを試してください。\n";
            }
            console.error(error);
        } finally {
            // ボタンを再度有効化
            convertButton.disabled = false;
        }
    });
});