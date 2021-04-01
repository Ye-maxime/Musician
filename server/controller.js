const path = require("path");
const fse = require("fs-extra");
const multiparty = require("multiparty");

const UPLOAD_DIR = path.resolve(__dirname, "target");

const extractExt = (fileName) => {
  return fileName.slice(fileName.lastIndexOf("."), fileName.length);
};

const resolvePost = (req) => {
  return new Promise((resolve) => {
    let chunk = "";
    req.on("data", (data) => {
      chunk += data;
    });

    req.on("end", () => {
      resolve(JSON.parse(chunk));
    });
  });
};

const mergeFileChunk = async (filePath, fileHash, size) => {
  const chunkDir = path.resolve(UPLOAD_DIR, fileHash);
  const chunkPaths = await fse.readdir(chunkDir);
  // 根据切片下标进行排序
  // 否则直接读取目录的获得的顺序可能会错乱
  chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1]);
  await Promise.all(
    chunkPaths.map((cp, index) => {
      return new Promise((resolve) => {
        const absolutePath = path.resolve(chunkDir, cp);
        const readStream = fse.createReadStream(absolutePath);
        readStream.on("end", () => {
          fse.unlinkSync(absolutePath);
          resolve();
        });

        // 指定位置创建可写流
        let writeStream = fse.createWriteStream(filePath, {
          start: index * size,
          end: (index + 1) * size,
        });
        readStream.pipe(writeStream);
      });
    })
  );

  // 合并后删除保存切片的目录
  fse.rmdirSync(chunkDir);
};

// 返回已经上传切片名
const createUploadedList = async (fileHash) =>
  fse.existsSync(path.resolve(UPLOAD_DIR, fileHash))
    ? await fse.readdir(path.resolve(UPLOAD_DIR, fileHash))
    : [];
class Controller {
  async handleFormData(req, res) {
    const mp = new multiparty.Form();
    mp.parse(req, async (err, fields, files) => {
      if (err) {
        res.status = 500;
        res.end("process file chunk failed");
        return;
      }

      const [chunk] = files.chunk;
      const [hash] = fields.hash;
      const [fileName] = fields.fileName;
      const [fileHash] = fields.fileHash;

      const filePath = path.resolve(
        UPLOAD_DIR,
        `${fileHash}${extractExt(fileName)}`
      );
      const chunkDir = path.resolve(UPLOAD_DIR, fileHash);

      // 文件存在直接返回
      if (fse.existsSync(filePath)) {
        res.end("file exist");
        return;
      }

      // 切片目录不存在，创建切片目录
      if (!fse.existsSync(chunkDir)) {
        await fse.mkdirs(chunkDir);
      }
      // 以 hash 作为文件名，将切片从临时路径移动切片文件夹中
      await fse.move(chunk.path, path.resolve(chunkDir, hash));
      res.end("received file chunk");
    });
  }

  async handleMerge(req, res) {
    const data = await resolvePost(req);
    const { fileName, fileHash, size } = data;
    const filePath = path.resolve(
      UPLOAD_DIR,
      `${fileHash}${extractExt(fileName)}`
    );
    await mergeFileChunk(filePath, fileHash, size);
    res.end(
      JSON.stringify({
        code: 0,
        message: "file merged success",
      })
    );
  }

  async handleVerifyUpload(req, res) {
    const data = await resolvePost(req);
    const { fileHash, fileName } = data;
    const ext = extractExt(fileName);
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`);
    if (fse.existsSync(filePath)) {
      res.end(
        JSON.stringify({
          shouldUpload: false,
        })
      );
    } else {
      res.end(
        JSON.stringify({
          shouldUpload: true,
          uploadedList: await createUploadedList(fileHash),
        })
      );
    }
  }
}

module.exports = Controller;
