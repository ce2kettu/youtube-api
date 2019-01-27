import 'isomorphic-fetch';
import express from 'express';
import YTMP3 from 'youtube-mp3-downloader';
import md5 from 'md5';
import fs from 'fs';
import findRemoveSync from 'find-remove';

let app = express();
const ROOT_URL = 'https://www.googleapis.com/youtube/v3/search';
const YT_API_KEY = '';
const STREAM_BASE_URL = 'http://localhost:3000/stream?videoId=';
const DOWNLOAD_BASE_URL = 'http://localhost:3000/download?videoId=';
let cache = [];


// Remove files older than 1 hour every hour.
setInterval(() => {
    findRemoveSync(__dirname + '/mp3', {
        files: '*.*',
        age: {
            seconds: 3600
        }
    });
    cache = [];
}, 600000); // every 10 minutes

function json(response) {
    return response.json()
}

function parseDuration(PT, format) {
    var output = [];
    var durationInSec = 0;
    var matches = PT.match(/P(?:(\d*)Y)?(?:(\d*)M)?(?:(\d*)W)?(?:(\d*)D)?T?(?:(\d*)H)?(?:(\d*)M)?(?:(\d*)S)?/i);
    var parts = [{
            pos: 1,
            multiplier: 86400 * 365
        },
        {
            pos: 2,
            multiplier: 86400 * 30
        },
        {
            pos: 3,
            multiplier: 604800
        },
        {
            pos: 4,
            multiplier: 86400
        },
        {
            pos: 5,
            multiplier: 3600
        },
        {
            pos: 6,
            multiplier: 60
        },
        {
            pos: 7,
            multiplier: 1
        }
    ];

    for (var i = 0; i < parts.length; i++) {
        if (typeof matches[parts[i].pos] != 'undefined') {
            durationInSec += parseInt(matches[parts[i].pos]) * parts[i].multiplier;
        }
    }
    var totalSec = durationInSec;
    if (durationInSec > 3599) {
        output.push(parseInt(durationInSec / 3600));
        durationInSec %= 3600;
    }
    output.push(('0' + parseInt(durationInSec / 60)).slice(-2));
    output.push(('0' + durationInSec % 60).slice(-2));
    if (format === undefined)
        return output.join(':');
    else if (format === 'sec')
        return totalSec;
}

async function getDuration(videoId) {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoId}&key=${YT_API_KEY}`);
    const data = await response.json();
    const duration = await parseDuration(data['items'][0]['contentDetails']['duration'], 'sec') || 0;
    return duration;
}

async function getSongData(obj) {
    const videoId = obj.id.videoId
    const duration = await getDuration(videoId);
    let artist = 'Unknown';
    let title = 'Unknown';
    const temp = obj.snippet.title.split('-');

    if (temp.length >= 2) {
        artist = temp[0].trim();
        title = temp[1].trim();
    }

    return {
        videoId: videoId || null,
        /* videoTitle: obj.snippet.title || null,
        channelTitle: obj.snippet.channelTitle || null, */
        title: obj.snippet.title || null,
        artist: obj.snippet.channelTitle || null,
        /* title: title || null,
        artist: artist || null, */
        duration: duration,
        streamUrl: STREAM_BASE_URL + videoId,
        downloadUrl: DOWNLOAD_BASE_URL + videoId,
        thumbnail: obj.snippet.thumbnails.default.url || null,
        youtubeUrl: `http://www.youtube.com/watch?v=${obj.id.videoId}` || null
    };
}

function returnSongs(data) {
    const temp = data['items'].map(async obj => {
        const response = await getSongData(obj);
        return response;
    });

    return Promise.all(temp).then(res => {
        return res;
    })
}

app.get('/search', (req, res) => {
    const params = {
        part: 'snippet',
        key: YT_API_KEY,
        q: req.query.q ? req.query.q : '',
        maxResults: req.query.maxResults ? req.query.maxResults : 21,
        type: req.query.type ? req.query.type : 'video'
    }

    const esc = encodeURIComponent;
    const query = Object.keys(params)
        .map(k => `${esc(k)}=${esc(params[k])}`)
        .join('&');

    fetch(`${ROOT_URL}?${query}`)
        .then(json)
        .then(data => {
            returnSongs(data)
                .then(data => {
                    res.json(data);
                })
        })
        .catch(error => {
            console.log(error);
        })

});

function checkIsDownloaded(videoId) {
    return new Promise(resolve => {
        var start_time = Date.now();

        function checkFlag() {
            if (cache[videoId] && cache[videoId].downloaded) {
                resolve();
            } else {
                setTimeout(checkFlag, 1000);
            }
        }
        checkFlag();
    });
}

async function download(videoId) {
    const hash = md5(videoId);

    if (cache[videoId]) {
        await checkIsDownloaded(videoId)
        return new Promise((resolve, reject) => {
            resolve(hash);
        });
    } else {
        cache[videoId] = {
            hash: hash,
            downloaded: false
        }

        const YD = new YTMP3({
            'ffmpegPath': 'ffmpeg',
            'outputPath': 'mp3',
            'youtubeVideoQuality': 'highest',
            'queueParallelism': 2,
            'progressTimeout': 2000
        });

        YD.download(videoId, `${hash}.mp3`);

        return new Promise((resolve, reject) => {
            YD.on('finished', (err, data) => {
                if (cache[videoId]) {
                    cache[videoId].downloaded = true;
                } else {
                    cache[videoId] = {
                        hash: hash,
                        downloaded: true
                    }
                }
                resolve(hash);
            });

            YD.on('error', err => {
                console.log(err);
            });
        });
    }
}

app.get('/stream', (req, res) => {
    const videoId = req.query.videoId;
    download(videoId)
        .then((name) => {
            res.redirect(`http://localhost/api/mp3/${name}.mp3`)
        })
});

app.get('/download', (req, res) => {
    const videoId = req.query.videoId;
    download(videoId)
        .then(name => {
            res.download(`http://localhost/api/mp3/${name}.mp3`)
        })
});

app.listen(3000);