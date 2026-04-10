const { exec } = require("child_process");

function getTranscript(videoUrl) {
    return new Promise((resolve, reject) => {
        const command = `yt-dlp --write-auto-subs --sub-lang en --skip-download -o "subtitles" ${videoUrl}`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error("Error:", error.message);
                return reject(error);
            }

            console.log("SUCCESS — transcript downloaded!");
            resolve();
        });
    });
}

getTranscript("https://www.youtube.com/watch?v=3JZ_D3ELwOQ");