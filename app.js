
const DB_NAME = "WavelengthLibrary";
const STORE_NAME = "songs";
const DB_VERSION = 1;

const audio = document.getElementById("audio");

const elements = {
    searchInput: document.getElementById("searchInput"),
    importButton: document.getElementById("importButton"),
    fileInput: document.getElementById("fileInput"),
    pageTitle: document.getElementById("pageTitle"),
    pageDescription: document.getElementById("pageDescription"),
    sectionTitle: document.getElementById("sectionTitle"),
    songCount: document.getElementById("songCount"),
    emptyState: document.getElementById("emptyState"),
    emptyImportButton: document.getElementById("emptyImportButton"),
    songList: document.getElementById("songList"),
    currentArt: document.getElementById("currentArt"),
    currentTitle: document.getElementById("currentTitle"),
    currentArtist: document.getElementById("currentArtist"),
    likeButton: document.getElementById("likeButton"),
    shuffleButton: document.getElementById("shuffleButton"),
    previousButton: document.getElementById("previousButton"),
    playButton: document.getElementById("playButton"),
    nextButton: document.getElementById("nextButton"),
    repeatButton: document.getElementById("repeatButton"),
    currentTime: document.getElementById("currentTime"),
    progress: document.getElementById("progress"),
    duration: document.getElementById("duration"),
    volume: document.getElementById("volume"),
    storageStatus: document.getElementById("storageStatus")
};

let db;
let songs = [];
let currentSong = null;
let currentAudioUrl = null;
let currentArtworkUrl = null;
let shuffle = false;
let repeat = false;
let likedSongs = new Set();
let currentPage = "home";

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = event => {
            const database = event.target.result;

            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getAllSongs() {
    return new Promise((resolve, reject) => {
        const request = db
            .transaction(STORE_NAME, "readonly")
            .objectStore(STORE_NAME)
            .getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

function saveSong(song) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(song);

        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
}

function deleteSong(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(id);

        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
}

// Read title, artist, album and embedded cover art from an audio file.
function readMetadata(blob, filename) {
    return new Promise(resolve => {
        if (!window.jsmediatags) {
            console.error("jsmediatags did not load.");
            resolve(null);
            return;
        }

        const file = new File([blob], filename, {
            type: blob.type || "audio/mpeg"
        });

        window.jsmediatags.read(file, {
            onSuccess: result => {
                const tags = result.tags || {};
                let artwork = null;

                if (tags.picture && tags.picture.data) {
                    const picture = tags.picture;
                    const imageBytes = new Uint8Array(picture.data);

                    artwork = new Blob([imageBytes], {
                        type: picture.format || "image/jpeg"
                    });
                }

                resolve({
                    title: tags.title || filename.replace(/\.[^/.]+$/, ""),
                    artist: tags.artist || "Unknown artist",
                    album: tags.album || "Unknown album",
                    artwork: artwork,
                    metadataRead: true
                });
            },

            onError: error => {
                console.warn("MP3 metadata could not be read:", filename, error);
                resolve(null);
            }
        });
    });
}

// Import new music.
async function importFiles(files) {
    const audioFiles = Array.from(files).filter(file =>
        file.type.startsWith("audio/") ||
        /\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(file.name)
    );

    if (!audioFiles.length) return;

    elements.storageStatus.textContent = "Importing music...";

    for (const file of audioFiles) {
        const metadata = await readMetadata(file, file.name);

        const song = {
            id: crypto.randomUUID(),
            name: file.name,
            title: metadata?.title || file.name.replace(/\.[^/.]+$/, ""),
            artist: metadata?.artist || "Unknown artist",
            album: metadata?.album || "Unknown album",
            artwork: metadata?.artwork || null,
            metadataRead: Boolean(metadata),
            size: file.size,
            blob: file,
            added: Date.now()
        };

        await saveSong(song);
    }

    await loadSongs();

    elements.storageStatus.textContent = "Music imported successfully.";
    elements.fileInput.value = "";
}

// Retry metadata reading for old imports, including previous failed attempts.
async function updateOldSongs() {
    for (const song of songs) {
        const needsMetadata =
            !song.metadataRead ||
            !song.artwork ||
            !song.artist ||
            song.artist === "Unknown artist";

        if (!needsMetadata || !song.blob) continue;

        const metadata = await readMetadata(song.blob, song.name);

        if (metadata) {
            song.title = metadata.title;
            song.artist = metadata.artist;
            song.album = metadata.album;
            song.artwork = metadata.artwork;
            song.metadataRead = true;

            await saveSong(song);
        }
    }
}

// Remove duplicate imports with the same filename and size.
async function removeDuplicates() {
    const seen = new Set();

    for (const song of songs) {
        const key = `${song.name}|${song.size}`;

        if (seen.has(key)) {
            await deleteSong(song.id);
        } else {
            seen.add(key);
        }
    }
}

async function loadSongs() {
    songs = await getAllSongs();

    await removeDuplicates();

    songs = await getAllSongs();

    elements.storageStatus.textContent = "Checking song information...";

    await updateOldSongs();

    songs = await getAllSongs();

    renderSongs();

    elements.storageStatus.textContent =
        `${songs.length} songs in your library`;
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";

    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);

    return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

// Creates an image using the song's embedded artwork.
function createArtwork(song, className = "") {
    const image = document.createElement("img");

    image.className = className;
    image.alt = `${song.title} cover`;

    if (song.artwork instanceof Blob && song.artwork.size > 0) {
        image.src = URL.createObjectURL(song.artwork);
    } else {
        image.src = "icons/icon-192.png";
        image.classList.add("default-artwork");
    }

    image.onerror = () => {
        image.src = "icons/icon-192.png";
    };

    return image;
}

function renderSongs() {
    const query = elements.searchInput.value.trim().toLowerCase();

    const visibleSongs = songs.filter(song => {
        const matchesSearch =
            (song.title || "").toLowerCase().includes(query) ||
            (song.artist || "").toLowerCase().includes(query) ||
            (song.album || "").toLowerCase().includes(query);

        if (currentPage === "liked") {
            return matchesSearch && likedSongs.has(song.id);
        }

        return matchesSearch;
    });

    elements.songList.replaceChildren();

    elements.songCount.textContent = `${visibleSongs.length} songs`;
    elements.emptyState.hidden = visibleSongs.length > 0;

    for (const song of visibleSongs) {
        const row = document.createElement("div");
        row.className = "song-row";
        row.tabIndex = 0;

        const artwork = createArtwork(song, "song-artwork");

        const details = document.createElement("div");
        details.className = "song-details";

        const title = document.createElement("div");
        title.className = "song-title";
        title.textContent = song.title || song.name;

        const artist = document.createElement("div");
        artist.className = "song-artist";
        artist.textContent = song.artist || "Unknown artist";

        details.append(title, artist);

        const album = document.createElement("div");
        album.className = "song-album";
        album.textContent = song.album || "Unknown album";

        row.append(artwork, details, album);

        row.addEventListener("click", () => playSong(song));

        row.addEventListener("keydown", event => {
            if (event.key === "Enter") playSong(song);
        });

        elements.songList.appendChild(row);
    }

    elements.sectionTitle.textContent =
        currentPage === "liked" ? "Liked Songs" : "Your Library";
}

function setCurrentArtwork(song) {
    if (currentArtworkUrl) {
        URL.revokeObjectURL(currentArtworkUrl);
        currentArtworkUrl = null;
    }

    elements.currentArt.replaceChildren();

    const image = document.createElement("img");
    image.alt = `${song.title} cover`;

    if (song.artwork instanceof Blob && song.artwork.size > 0) {
        currentArtworkUrl = URL.createObjectURL(song.artwork);
        image.src = currentArtworkUrl;
    } else {
        image.src = "icons/icon-192.png";
    }

    elements.currentArt.appendChild(image);
}

async function playSong(song) {
    if (!song) return;

    currentSong = song;

    if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
    }

    currentAudioUrl = URL.createObjectURL(song.blob);
    audio.src = currentAudioUrl;

    elements.currentTitle.textContent = song.title || song.name;
    elements.currentArtist.textContent = song.artist || "Unknown artist";

    setCurrentArtwork(song);

    try {
        await audio.play();
    } catch (error) {
        console.error("Playback error:", error);
    }

    updatePlayButton();
}

function updatePlayButton() {
    elements.playButton.textContent = audio.paused ? "▶" : "Ⅱ";
}

function togglePlayback() {
    if (!currentSong) {
        if (songs.length) playSong(songs[0]);
        return;
    }

    if (audio.paused) {
        audio.play().catch(console.error);
    } else {
        audio.pause();
    }

    updatePlayButton();
}

function nextSong() {
    if (!songs.length) return;

    let index = songs.findIndex(song => song.id === currentSong?.id);

    if (shuffle && songs.length > 1) {
        let nextIndex;

        do {
            nextIndex = Math.floor(Math.random() * songs.length);
        } while (nextIndex === index);

        index = nextIndex;
    } else {
        index = (index + 1) % songs.length;
    }

    playSong(songs[index]);
}

function previousSong() {
    if (!songs.length) return;

    if (audio.currentTime > 3) {
        audio.currentTime = 0;
        return;
    }

    let index = songs.findIndex(song => song.id === currentSong?.id);
    index = (index - 1 + songs.length) % songs.length;

    playSong(songs[index]);
}

function toggleLike() {
    if (!currentSong) return;

    if (likedSongs.has(currentSong.id)) {
        likedSongs.delete(currentSong.id);
    } else {
        likedSongs.add(currentSong.id);
    }

    elements.likeButton.textContent =
        likedSongs.has(currentSong.id) ? "♥" : "♡";

    renderSongs();
}

function setupEvents() {
    elements.importButton.addEventListener("click", () => {
        elements.fileInput.click();
    });

    elements.emptyImportButton?.addEventListener("click", () => {
        elements.fileInput.click();
    });

    elements.fileInput.addEventListener("change", event => {
        importFiles(event.target.files).catch(error => {
            console.error(error);
            elements.storageStatus.textContent = "Import failed.";
        });
    });

    elements.searchInput.addEventListener("input", renderSongs);

    elements.playButton.addEventListener("click", togglePlayback);
    elements.nextButton.addEventListener("click", nextSong);
    elements.previousButton.addEventListener("click", previousSong);
    elements.likeButton.addEventListener("click", toggleLike);

    elements.shuffleButton.addEventListener("click", () => {
        shuffle = !shuffle;
        elements.shuffleButton.classList.toggle("active", shuffle);
    });

    elements.repeatButton.addEventListener("click", () => {
        repeat = !repeat;
        elements.repeatButton.classList.toggle("active", repeat);
    });

    elements.volume.addEventListener("input", () => {
        audio.volume = Number(elements.volume.value);
    });

    elements.progress.addEventListener("input", () => {
        if (Number.isFinite(audio.duration)) {
            audio.currentTime =
                (Number(elements.progress.value) / 100) * audio.duration;
        }
    });

    audio.addEventListener("timeupdate", () => {
        if (!Number.isFinite(audio.duration)) return;

        elements.progress.value =
            (audio.currentTime / audio.duration) * 100;

        elements.currentTime.textContent = formatTime(audio.currentTime);
        elements.duration.textContent = formatTime(audio.duration);
    });

    audio.addEventListener("loadedmetadata", () => {
        elements.duration.textContent = formatTime(audio.duration);
    });

    audio.addEventListener("play", updatePlayButton);
    audio.addEventListener("pause", updatePlayButton);

    audio.addEventListener("ended", () => {
        if (repeat) {
            audio.currentTime = 0;
            audio.play();
        } else {
            nextSong();
        }
    });

    document.querySelectorAll(".nav-item").forEach(button => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".nav-item").forEach(item => {
                item.classList.remove("active");
            });

            button.classList.add("active");
            currentPage = button.dataset.page || "home";

            const pages = {
                home: ["Home", "Your music, all in one place."],
                search: ["Search", "Find something to listen to."],
                library: ["Your Library", "All your imported music."],
                liked: ["Liked Songs", "Your favorite tracks."]
            };

            const page = pages[currentPage] || pages.home;

            elements.pageTitle.textContent = page[0];
            elements.pageDescription.textContent = page[1];

            renderSongs();
        });
    });
}

async function initialize() {
    try {
        db = await openDatabase();

        setupEvents();

        audio.volume = Number(elements.volume.value || 0.8);

        await loadSongs();

        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("service-worker.js")
                .catch(error => console.warn("Service worker:", error));
        }

        if (!window.jsmediatags) {
            elements.storageStatus.textContent =
                "Music loaded, but the cover-art reader did not load. Check your internet connection.";
        }
    } catch (error) {
        console.error("Wavelength initialization failed:", error);
        elements.storageStatus.textContent =
            "Could not load your music library.";
    }
}

initialize();
