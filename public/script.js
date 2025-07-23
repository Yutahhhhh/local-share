class ScreenShareApp {
  constructor() {
    this.socket = io();
    this.currentUsername = "";
    this.isSharing = false;
    this.currentStream = null;
    this.peerConnections = new Map();
    this.currentViewingHost = null;
    this.viewerConnection = null;
    this.isFullscreen = false;

    this.initializeEventListeners();
    this.setupSocketEvents();
  }

  initializeEventListeners() {
    // ユーザー名設定
    document.getElementById("username-submit").addEventListener("click", () => {
      const username = document.getElementById("username-input").value.trim();
      if (username) {
        this.socket.emit("set-username", username);
      }
    });

    document
      .getElementById("username-input")
      .addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          document.getElementById("username-submit").click();
        }
      });

    // 画面共有制御
    document.getElementById("start-share-btn").addEventListener("click", () => {
      this.startSharing();
    });

    document.getElementById("stop-share-btn").addEventListener("click", () => {
      this.stopSharing();
    });

    // 全画面モード制御
    document.getElementById("fullscreen-btn").addEventListener("click", () => {
      this.toggleFullscreen();
    });

    // ESCキーで全画面モードを終了
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isFullscreen) {
        this.exitFullscreen();
      }
    });

    // 全画面変更イベントの監視
    document.addEventListener("fullscreenchange", () => {
      this.handleFullscreenChange();
    });
  }

  setupSocketEvents() {
    this.socket.on("username-set", (username) => {
      this.currentUsername = username;
      document.getElementById(
        "current-user"
      ).textContent = `ユーザー: ${username}`;
      document.getElementById("username-modal").style.display = "none";
    });

    this.socket.on("user-joined", (data) => {
      document.getElementById(
        "user-count"
      ).textContent = `${data.userCount}人が接続中`;
    });

    this.socket.on("user-left", (data) => {
      document.getElementById(
        "user-count"
      ).textContent = `${data.userCount}人が接続中`;
    });

    this.socket.on("sharing-started", () => {
      this.isSharing = true;
      document.getElementById("start-share-btn").style.display = "none";
      document.getElementById("stop-share-btn").style.display = "block";
      document.getElementById("viewers-section").style.display = "block";
    });

    this.socket.on("sharing-stopped", () => {
      this.isSharing = false;
      document.getElementById("start-share-btn").style.display = "block";
      document.getElementById("stop-share-btn").style.display = "none";
      document.getElementById("viewers-section").style.display = "none";
      this.stopCurrentStream();
    });

    this.socket.on("share-available", (data) => {
      this.addAvailableShare(data);
    });

    this.socket.on("share-unavailable", (data) => {
      this.removeAvailableShare(data.hostId);
    });

    this.socket.on("active-shares", (shares) => {
      this.updateAvailableShares(shares);
    });

    this.socket.on("viewer-joined", (data) => {
      this.onViewerJoined(data);
    });

    this.socket.on("viewer-left", (data) => {
      this.onViewerLeft(data);
    });

    this.socket.on("viewers-updated", (data) => {
      this.handleViewersUpdated(data);
    });

    // WebRTC シグナリング
    this.socket.on("offer", (data) => {
      this.onOffer(data);
    });

    this.socket.on("answer", (data) => {
      this.onAnswer(data);
    });

    this.socket.on("ice-candidate", (data) => {
      this.onIceCandidate(data);
    });

    this.socket.on("joined-as-viewer", (data) => {
      this.onJoinedAsViewer(data);
    });

    this.socket.on("share-ended", (data) => {
      this.onShareEnded(data);
    });
  }

  async startSharing() {
    if (!this.checkScreenShareSupport()) {
      return;
    }

    const shareTypeElement = document.querySelector(
      'input[name="shareType"]:checked'
    );

    // デフォルトで "screen" を使用（HTMLで checked されているはず）
    const shareType = shareTypeElement ? shareTypeElement.value : "screen";

    console.debug("選択された共有タイプ:", shareType);

    try {
      this.currentStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      this.displayLocalStream();

      this.currentStream.getVideoTracks()[0].addEventListener("ended", () => {
        this.stopSharing();
      });

      this.socket.emit("start-sharing", { shareType });
      this.showSuccess("画面共有を開始しました");
    } catch (error) {
      console.error("画面共有の開始に失敗:", error);
      this.handleScreenShareError(error);
    }
  }

  // ローカルストリームを表示する関数
  displayLocalStream() {
    const video = document.getElementById("main-video");
    const videoContainer = document.getElementById("video-container");
    const noStreamEls = videoContainer.querySelectorAll(".no-stream");

    if (video && this.currentStream) {
      video.srcObject = this.currentStream;
      video.style.display = "block";
      video.muted = true; // ローカルストリームはミュート

      noStreamEls.forEach((el) => {
        el.style.display = "none";
      });

      // 全画面ボタンを表示
      this.showFullscreenButton();

      console.debug("ローカルストリームを表示しました");
      console.debug("非表示にした要素数:", noStreamEls.length);
    }
  }

  checkScreenShareSupport() {
    if (
      !window.isSecureContext &&
      location.hostname !== "localhost" &&
      location.hostname !== "127.0.0.1"
    ) {
      this.showError(
        "画面共有はHTTPS環境またはlocalhost環境でのみ利用可能です。"
      );
      return false;
    }

    if (!navigator.mediaDevices) {
      this.showError("お使いのブラウザは画面共有をサポートしていません。");
      return false;
    }

    if (!navigator.mediaDevices.getDisplayMedia) {
      this.showError("お使いのブラウザは画面共有機能をサポートしていません。");
      return false;
    }

    return true;
  }

  onScreenShareError(error) {
    let errorMessage = "画面共有の開始に失敗しました。";

    if (error.name === "NotAllowedError") {
      errorMessage = "画面共有が拒否されました。";
    } else if (error.name === "NotSupportedError") {
      errorMessage = "ブラウザが画面共有をサポートしていません。";
    } else if (error.name === "NotFoundError") {
      errorMessage = "共有可能な画面が見つかりませんでした。";
    } else if (error.name === "AbortError") {
      errorMessage = "画面共有がキャンセルされました。";
    }

    this.showError(errorMessage);
  }

  showError(message) {
    const existingError = document.querySelector(".error-message");
    if (existingError) {
      existingError.remove();
    }

    const errorDiv = document.createElement("div");
    errorDiv.className = "error-message";
    errorDiv.textContent = message;

    const shareControls = document.getElementById("share-controls");
    shareControls.insertBefore(errorDiv, shareControls.firstChild);

    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.remove();
      }
    }, 5000);
  }

  showSuccess(message) {
    const existing = document.querySelector(".success-message");
    if (existing) {
      existing.remove();
    }

    const successDiv = document.createElement("div");
    successDiv.className = "success-message";
    successDiv.textContent = message;

    const shareControls = document.getElementById("share-controls");
    shareControls.insertBefore(successDiv, shareControls.firstChild);

    setTimeout(() => {
      if (successDiv.parentNode) {
        successDiv.remove();
      }
    }, 3000);
  }

  stopSharing() {
    this.socket.emit("stop-sharing");
    this.stopCurrentStream();

    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();

    this.resetVideoDisplay();
  }

  stopCurrentStream() {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => track.stop());
      this.currentStream = null;
    }
  }

  // ビデオ表示をリセット
  resetVideoDisplay() {
    const video = document.getElementById("main-video");
    const videoContainer = document.getElementById("video-container");
    const noStreamEls = videoContainer.querySelectorAll(".no-stream");

    if (video) {
      video.style.display = "none";
      video.srcObject = null;
    }

    // すべての no-stream 要素を表示
    noStreamEls.forEach((el) => {
      el.style.display = "block";
    });

    // 全画面ボタンを隠す
    this.hideFullscreenButton();

    console.debug("ビデオ表示をリセットしました");
  }

  updateAvailableShares(shares) {
    const container = document.getElementById("available-shares");
    container.innerHTML = "";

    if (shares.length === 0) {
      container.innerHTML = '<p class="no-stream">共有中の画面はありません</p>';
      return;
    }

    shares.forEach((share) => {
      this.addAvailableShare(share);
    });
  }

  addAvailableShare(share) {
    const container = document.getElementById("available-shares");
    const noStreamMsg = container.querySelector(".no-stream");
    if (noStreamMsg) {
      noStreamMsg.remove();
    }

    // 既存の要素があれば更新、なければ新規作成
    let shareEl = document.getElementById(`share-${share.hostId}`);
    if (!shareEl) {
      shareEl = document.createElement("div");
      shareEl.className = "share-session";
      shareEl.id = `share-${share.hostId}`;
      container.appendChild(shareEl);
    }

    const shareTypeIcon = {
      screen: "🖥️",
      window: "🪟",
      tab: "🌐",
    };

    const shareTypeText = {
      screen: "画面共有",
      window: "ウィンドウ共有", 
      tab: "タブ共有",
    };

    const viewerCount = share.viewerCount || 0;
    const viewerText = viewerCount === 0 ? "視聴者なし" : `${viewerCount}人が視聴中`;

    // 現在視聴中かどうかをチェック
    const isCurrentlyViewing = this.currentViewingHost === share.hostId;
    const buttonText = isCurrentlyViewing ? "視聴終了" : "視聴";
    const buttonClass = isCurrentlyViewing ? "btn-danger" : "btn-secondary";
    const onClickHandler = isCurrentlyViewing ? `onclick="stopViewingGlobal()"` : `onclick="joinAsViewerGlobal('${share.hostId}')"`;

    shareEl.innerHTML = `
          <div class="share-info">
            <div>
              <strong>${shareTypeIcon[share.shareType]} ${share.hostUsername}</strong>
              <div class="share-details">${viewerText}</div>
            </div>
            <button class="${buttonClass}" ${onClickHandler}>${buttonText}</button>
          </div>
        `;
  }

  removeAvailableShare(hostId) {
    const shareEl = document.getElementById(`share-${hostId}`);
    if (shareEl) {
      shareEl.remove();
    }

    const container = document.getElementById("available-shares");
    if (container.children.length === 0) {
      container.innerHTML = '<p class="no-stream">共有中の画面はありません</p>';
    }
  }

  async joinAsViewer(hostId) {
    console.debug("視聴を開始します:", hostId);
    
    // 既に同じホストを視聴中の場合は何もしない
    if (this.currentViewingHost === hostId) {
      console.debug("既に同じホストを視聴中です");
      return;
    }

    // 他のホストを視聴中の場合は停止
    if (this.currentViewingHost && this.viewerConnection) {
      console.debug("他の視聴を停止します");
      this.viewerConnection.close();
      this.viewerConnection = null;
      this.resetVideoDisplay();
    }

    this.currentViewingHost = hostId;

    // ★ 修正3: 自分の共有を停止してから他の人の共有を視聴
    if (this.isSharing) {
      this.stopSharing();
    }

    this.socket.emit("join-viewer", hostId);
    
    // UIを更新（ボタンの状態を変更）
    this.updateAllShareButtons();
  }

  async onJoinedAsViewer(data) {
    console.debug("視聴者として参加しました:", data);

    this.viewerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
      ],
      iceCandidatePoolSize: 10,
    });

    // 接続状態の監視
    this.viewerConnection.onconnectionstatechange = () => {
      console.debug("★ 視聴者側接続状態:", this.viewerConnection.connectionState);
      if (this.viewerConnection.connectionState === "connected") {
        console.debug("WebRTC接続を開始しました");
      } else if (this.viewerConnection.connectionState === "failed") {
        console.error("WebRTC接続に失敗しました");
        this.showError("接続に失敗しました。再試行してください。");
      }
    };

    this.viewerConnection.oniceconnectionstatechange = () => {
      console.debug(
        "★ 視聴者側ICE接続状態:",
        this.viewerConnection.iceConnectionState
      );
      if (
        this.viewerConnection.iceConnectionState === "connected" ||
        this.viewerConnection.iceConnectionState === "completed"
      ) {
        console.debug("ICE接続を開始しました");
      } else if (this.viewerConnection.iceConnectionState === "failed") {
        console.error("ICE接続に失敗しました");
      }
    };

    this.viewerConnection.ontrack = (event) => {
      console.debug("★ ontrack イベントが発火しました:", event);
      console.debug("受信したストリーム数:", event.streams.length);
      console.debug("受信したトラック:", event.track);
      console.debug("トラックの種類:", event.track.kind);
      console.debug("トラックの状態:", event.track.readyState);

      if (event.streams && event.streams[0]) {
        const video = document.getElementById("main-video");
        const videoContainer = document.getElementById("video-container");
        const noStreamEls = videoContainer.querySelectorAll(".no-stream");

        if (video) {
          console.debug("ビデオ要素にストリームを設定中...");
          video.srcObject = event.streams[0];
          video.style.display = "block";
          video.muted = false; // 視聴時はミュートしない

          // すべての no-stream 要素を非表示にする
          noStreamEls.forEach((el) => {
            el.style.display = "none";
          });

          // 全画面ボタンを表示
          this.showFullscreenButton();

          console.debug("ビデオ要素にストリームを設定しました");
          console.debug("非表示にした要素数:", noStreamEls.length);

          video
            .play()
            .then(() => {
              console.debug("ビデオの再生開始に成功");
            })
            .catch((e) => {
              console.debug("ビデオの自動再生に失敗:", e);
            });
        } else {
          console.error("main-video要素が見つかりません");
        }
      } else {
        console.error("ストリームが受信されませんでした");
      }
    };

    this.viewerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.debug("★ ICE候補を送信（視聴者側）:", {
          type: event.candidate.type,
          protocol: event.candidate.protocol,
          address: event.candidate.address,
        });
        this.socket.emit("ice-candidate", {
          targetId: data.hostId,
          candidate: event.candidate,
        });
      } else {
        console.debug("★ ICE収集完了（視聴者側）");
      }
    };

    // ★ 修正6: オファー作成時の設定を改善
    console.debug("オファーを作成しています...");
    const offer = await this.viewerConnection.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: false,
    });
    await this.viewerConnection.setLocalDescription(offer);

    console.debug("オファーを送信:", offer);
    this.socket.emit("offer", {
      hostId: data.hostId,
      offer: offer,
    });
  }

  async onOffer(data) {
    console.debug("オファーを受信しました（ホスト側）:", data);

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
      ],
      iceCandidatePoolSize: 10,
    });

    // 接続状態の監視
    pc.onconnectionstatechange = () => {
      console.debug("★ ホスト側接続状態:", pc.connectionState);
      if (pc.connectionState === "connected") {
        console.debug("✅ ホスト側WebRTC接続を開始しました");
      } else if (pc.connectionState === "failed") {
        console.error("❌ ホスト側WebRTC接続に失敗しました");
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.debug("★ ホスト側ICE接続状態:", pc.iceConnectionState);
      if (
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        console.debug("✅ ホスト側ICE接続を開始しました");
      } else if (pc.iceConnectionState === "failed") {
        console.error("❌ ホスト側ICE接続に失敗しました");
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.debug("★ ICE候補を送信（ホスト側）:", {
          type: event.candidate.type,
          protocol: event.candidate.protocol,
          address: event.candidate.address,
        });
        this.socket.emit("ice-candidate", {
          targetId: data.viewerId,
          candidate: event.candidate,
        });
      } else {
        console.debug("★ ICE収集完了（ホスト側）");
      }
    };

    if (this.currentStream) {
      console.debug("★ ストリームをピアに追加します");
      console.debug("現在のストリーム:", this.currentStream);
      console.debug("利用可能なトラック:", this.currentStream.getTracks());

      let addedTracks = 0;
      this.currentStream.getTracks().forEach((track) => {
        console.debug(`トラック ${track.kind} (${track.id}):`, {
          readyState: track.readyState,
          enabled: track.enabled,
          muted: track.muted,
        });

        if (track.readyState === "live") {
          try {
            const sender = pc.addTrack(track, this.currentStream);
            console.debug("トラック追加成功:", sender);
            addedTracks++;
          } catch (error) {
            console.error("トラック追加エラー:", error);
          }
        } else {
          console.warn("トラックが無効状態:", track.readyState);
        }
      });

      console.debug(
        `★ 追加されたトラック数: ${addedTracks}/${
          this.currentStream.getTracks().length
        }`
      );

      if (addedTracks === 0) {
        console.error("有効なトラックが追加されませんでした");
        this.showError("画面共有ストリームに有効なトラックがありません");
        return;
      }
    } else {
      console.error("currentStreamが存在しません");
      this.showError("画面共有ストリームが見つかりません");
      return;
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      console.debug("アンサーを送信:", answer);
      this.socket.emit("answer", {
        viewerId: data.viewerId,
        answer: answer,
      });

      this.peerConnections.set(data.viewerId, pc);
      console.debug("ピア接続を保存しました:", data.viewerId);
    } catch (error) {
      console.error("WebRTCネゴシエーションエラー:", error);
      this.showError("接続に失敗しました");
    }
  }

  async onAnswer(data) {
    console.debug("アンサーを受信しました（視聴者側）:", data);
    if (this.viewerConnection) {
      try {
        await this.viewerConnection.setRemoteDescription(
          new RTCSessionDescription(data.answer)
        );
        console.debug("リモート記述を設定しました");
      } catch (error) {
        console.error("リモート記述の設定に失敗:", error);
      }
    } else {
      console.error("viewerConnectionが存在しません");
    }
  }

  async onIceCandidate(data) {
    console.debug("★ ICE候補を受信:", {
      fromId: data.fromId,
      type: data.candidate.type,
      protocol: data.candidate.protocol,
    });

    const pc = this.peerConnections.get(data.fromId) || this.viewerConnection;
    if (pc && pc.remoteDescription) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.debug("ICE候補を追加しました");
      } catch (error) {
        console.error("ICE候補の追加に失敗:", error);
      }
    } else {
      console.warn("ピア接続が見つからないか、リモート記述が設定されていません");
      console.debug("現在のピア接続:", this.peerConnections);
      console.debug("視聴者接続:", this.viewerConnection);
      console.debug("リモート記述:", pc ? pc.remoteDescription : "なし");
    }
  }

  onViewerJoined(data) {
    console.debug("視聴者が参加しました:", data);
    this.updateViewerList(data.viewers || []);
    
    // 利用可能な共有リストの視聴者数も更新
    if (this.isSharing) {
      this.updateShareViewerCount(this.socket.id, data.viewerCount);
    }
  }

  onViewerLeft(data) {
    console.debug("視聴者が離脱しました:", data);
    this.updateViewerList(data.viewers || []);

    const pc = this.peerConnections.get(data.viewerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(data.viewerId);
    }
    
    // 利用可能な共有リストの視聴者数も更新
    if (this.isSharing) {
      this.updateShareViewerCount(this.socket.id, data.viewerCount);
    }
  }

  handleViewersUpdated(data) {
    console.debug("視聴者リストが更新されました:", data);
    
    // 自分が共有中の場合、視聴者リストを更新
    if (this.isSharing && data.hostId === this.socket.id) {
      this.updateViewerList(data.viewers || []);
    }
    
    // 利用可能な共有リストの視聴者数を更新
    this.updateShareViewerCount(data.hostId, data.viewerCount);
  }

  onShareEnded(data) {
    if (this.currentViewingHost === data.hostId) {
      this.currentViewingHost = null;
      if (this.viewerConnection) {
        this.viewerConnection.close();
        this.viewerConnection = null;
      }

      this.resetVideoDisplay();
      
      // UIを更新（ボタンの状態を変更）
      this.updateAllShareButtons();
    }
  }

  updateViewerList(viewers = []) {
    const viewerList = document.getElementById("viewer-list");
    
    if (!viewers || viewers.length === 0) {
      viewerList.innerHTML = '<div class="viewer-item">視聴者はいません</div>';
      return;
    }

    viewerList.innerHTML = viewers
      .map(viewer => `<div class="viewer-item">${viewer.username}</div>`)
      .join('');
  }

  updateShareViewerCount(hostId, viewerCount) {
    const shareEl = document.getElementById(`share-${hostId}`);
    if (shareEl) {
      const shareDetails = shareEl.querySelector('.share-details');
      if (shareDetails) {
        const viewerText = viewerCount === 0 ? "視聴者なし" : `${viewerCount}人が視聴中`;
        shareDetails.textContent = viewerText;
      }
      
      // ボタンの状態も更新
      this.updateShareButton(hostId);
    }
  }

  updateShareButton(hostId) {
    const shareEl = document.getElementById(`share-${hostId}`);
    if (shareEl) {
      const button = shareEl.querySelector('button');
      if (button) {
        const isCurrentlyViewing = this.currentViewingHost === hostId;
        
        if (isCurrentlyViewing) {
          button.textContent = "視聴終了";
          button.className = "btn-danger";
          button.setAttribute('onclick', 'stopViewingGlobal()');
        } else {
          button.textContent = "視聴";
          button.className = "btn-secondary";
          button.setAttribute('onclick', `joinAsViewerGlobal('${hostId}')`);
        }
      }
    }
  }

  stopViewing() {
    if (this.currentViewingHost && this.viewerConnection) {
      console.debug("視聴を終了します:", this.currentViewingHost);
      
      // WebRTC接続を閉じる
      this.viewerConnection.close();
      this.viewerConnection = null;
      
      // サーバーに視聴終了を通知
      this.socket.emit("leave-viewer", this.currentViewingHost);
      
      // 状態をリセット
      this.currentViewingHost = null;
      
      // ビデオ表示をリセット
      this.resetVideoDisplay();
      
      // UIを更新
      this.updateAllShareButtons();
      
      console.debug("視聴を終了しました");
    }
  }

  updateAllShareButtons() {
    // 全ての共有セッションのボタン状態を更新
    const shareElements = document.querySelectorAll('.share-session');
    shareElements.forEach(shareEl => {
      const hostId = shareEl.id.replace('share-', '');
      this.updateShareButton(hostId);
    });
  }

  // 全画面モードの切り替え
  toggleFullscreen() {
    if (this.isFullscreen) {
      this.exitFullscreen();
    } else {
      this.enterFullscreen();
    }
  }

  // 全画面モードに入る
  enterFullscreen() {
    const video = document.getElementById("main-video");
    const videoContainer = document.getElementById("video-container");
    const fullscreenBtn = document.getElementById("fullscreen-btn");

    // ビデオが表示されていない場合は全画面モードにしない
    if (!video || video.style.display === "none") {
      console.debug("ビデオが表示されていないため、全画面モードに入れません");
      return;
    }

    // CSSクラスを追加して全画面スタイルを適用
    videoContainer.classList.add("fullscreen");
    document.body.classList.add("fullscreen-active");
    
    // ボタンのアイコンを変更
    const fullscreenIcon = fullscreenBtn.querySelector(".fullscreen-icon");
    if (fullscreenIcon) {
      fullscreenIcon.textContent = "⛶";
    }
    fullscreenBtn.title = "全画面終了";

    this.isFullscreen = true;
    console.debug("全画面モードに入りました");
  }

  // 全画面モードを終了
  exitFullscreen() {
    const videoContainer = document.getElementById("video-container");
    const fullscreenBtn = document.getElementById("fullscreen-btn");

    // CSSクラスを削除して通常スタイルに戻す
    videoContainer.classList.remove("fullscreen");
    document.body.classList.remove("fullscreen-active");
    
    // ボタンのアイコンを変更
    const fullscreenIcon = fullscreenBtn.querySelector(".fullscreen-icon");
    if (fullscreenIcon) {
      fullscreenIcon.textContent = "⛶";
    }
    fullscreenBtn.title = "全画面表示";

    this.isFullscreen = false;
    console.debug("全画面モードを終了しました");
  }

  // ブラウザの全画面API変更イベントのハンドラ
  handleFullscreenChange() {
    // ブラウザの全画面APIとの同期は今回は実装しない
    // 必要に応じて将来的に追加可能
  }

  // ビデオが表示されたときに全画面ボタンを表示
  showFullscreenButton() {
    const fullscreenBtn = document.getElementById("fullscreen-btn");
    if (fullscreenBtn) {
      fullscreenBtn.style.display = "block";
    }
  }

  // ビデオが非表示になったときに全画面ボタンを隠す
  hideFullscreenButton() {
    const fullscreenBtn = document.getElementById("fullscreen-btn");
    if (fullscreenBtn) {
      fullscreenBtn.style.display = "none";
    }
    
    // 全画面モード中の場合は終了
    if (this.isFullscreen) {
      this.exitFullscreen();
    }
  }

  // 現在の状態を確認
  debugCurrentState() {
    console.debug("=== 現在の状態 ===");
    console.debug("ユーザー名:", this.currentUsername);
    console.debug("共有中:", this.isSharing);
    console.debug("全画面モード:", this.isFullscreen);
    console.debug("現在のストリーム:", this.currentStream);
    if (this.currentStream) {
      console.debug("ストリームトラック:", this.currentStream.getTracks());
    }
    console.debug("ピア接続数:", this.peerConnections.size);
    console.debug("視聴中のホスト:", this.currentViewingHost);
    console.debug("視聴者接続:", this.viewerConnection);
    if (this.viewerConnection) {
      console.debug("視聴者接続状態:", this.viewerConnection.connectionState);
      console.debug("ICE接続状態:", this.viewerConnection.iceConnectionState);
    }
    console.debug("==================");
  }
}

// アプリケーション初期化
let app;

// グローバル関数（HTMLのonclick属性から呼び出されるため）
window.joinAsViewerGlobal = (hostId) => {
  if (app) {
    app.joinAsViewer(hostId);
  } else {
    console.error("アプリケーションが初期化されていません");
  }
};

window.stopViewingGlobal = () => {
  if (app) {
    app.stopViewing();
  } else {
    console.error("アプリケーションが初期化されていません");
  }
};

// DOMが完全に読み込まれてからアプリを初期化
document.addEventListener("DOMContentLoaded", () => {
  app = new ScreenShareApp();

  // デバッグ用のグローバル関数
  window.debugApp = () => app.debugCurrentState();

  // ページ読み込み時にユーザー名入力にフォーカス
  const usernameInput = document.getElementById("username-input");
  if (usernameInput) {
    usernameInput.focus();
  }

  console.debug("アプリケーションが初期化されました");
});
