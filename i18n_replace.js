const fs = require("fs");
const path = require("path");
const crypto = require("crypto"); // 加密算法
const http = require("http");
const querystring = require("querystring");


// 用户自行配置
const filePath = path.resolve("src/views/"); // 需要翻译的vue/js 代码路径
const longfilepath = "src/lang/"; // 输出翻译配置文件路径
const orignalLanguage = "zh-CHS"; // 原始语言
const descLanguage = "en"; // 翻译后的语言
// 语言列表查看https://ai.youdao.com/DOCSIRMA/html/%E8%87%AA%E7%84%B6%E8%AF%AD%E8%A8%80%E7%BF%BB%E8%AF%91/API%E6%96%87%E6%A1%A3/%E6%96%87%E6%9C%AC%E7%BF%BB%E8%AF%91%E6%9C%8D%E5%8A%A1/%E6%96%87%E6%9C%AC%E7%BF%BB%E8%AF%91%E6%9C%8D%E5%8A%A1-API%E6%96%87%E6%A1%A3.html#section-12
const appKey = "41deaeef0909ef75";
const appSecret = "DYe63d1dEgzvRUVG9Yaf2jMWtXWeOeFq";
const translateDelay = 1 // 调用翻译接口间隔时间，时间太快翻译接口会提示频率受限

let scriptCH_N = { app: {} }, scriptDESC = { app: {} }; // 写入的文件格式
let translateQueue = Promise.resolve(); // 翻译请求队列

readFiles(filePath);


/**
 * 文件遍历方法
 * @param filePath 需要遍历的文件路径
 */
function readFiles(filePath) {
  //根据文件路径读取文件，返回文件列表
  fs.readdir(filePath, function (err, files) {
    if (err) {
      console.warn(err);
    } else {
      //遍历读取到的文件列表
      files.forEach(function (filename) {
        //获取当前文件的绝对路径
        var filedir = path.join(filePath, filename);
        //根据文件路径获取文件信息，返回一个fs.Stats对象
        fs.stat(filedir, function (eror, stats) {
          if (eror) {
            console.warn("获取文件stats失败");
          } else {
            var isFile = stats.isFile(); //是文件
            var isDir = stats.isDirectory(); //是文件夹
            if (isFile && /.vue|.js$/.test(filedir)) {
              prasefile(filedir);
            }
            if (isDir && !/lang|router|scss|fonts$/.test(filedir)) {
              //是文件夹并且不是以上这些文件夹
              readFiles(filedir); //递归遍历，如果是文件夹，就继续遍历该文件夹下面的文件
            }
          }
        });
      });
    }
  });
}

/*  
  解析文件
  提取代码中的汉字
 */
function prasefile(filename) {
  let data = fs.readFileSync(filename, "utf8");
  let buffer = "", wordArr = [];
  // 过滤注释
  let commentReg = /(\/\/.*)|(\/\*[\s\S]*?\*\/)|((?:^|\n|\r)\s*<!--[\s\S]*?-->\s*(?:\r|\n|$))|((?:^|\n|\r)\s*\/\*[\s\S]*?\*\/\s*(?:\r|\n|$))/g;
  data = data.replace(commentReg, "");
  // 提取汉字得到汉字词语数组wordArr
  for (let i = 0; i < data.length; i++) {
    // 提取出汉字
    if ( /[\u4E00-\u9FA5]/g.test(data[i]) ) {
      buffer += data[i];
    } else {
      if (buffer.length > 0) {
        wordArr.push(buffer);
      }
      buffer = "";
    }
  }
  // 翻译
  translate(wordArr, filename)
}

/*  
  翻译汉字
  调用有道翻译  http://ai.youdao.com
  http://ai.youdao.com/docs/doc-trans-api.s#p01 有道智云翻译 API 简介
  在有道智云上新建一个应用，创建一个自然语言翻译示例， 将实例绑定到应用，就可以使用啦
*/
function translate(wordArr, filename) {
  let salt = "", curtime = "", sign = "";
  let hash = crypto.createHash("sha256"); // sha256或者md5  
  // UUID 必须要唯一
  salt = guid();
  // 当前UTC时间戳(秒)
  curtime = Math.round(new Date().getTime() / 1000);
  // 生成签名
  sign = hash.update(appKey + truncate(wordArr.join("")) + salt + curtime + appSecret).digest("hex");
  // 组成参数
  var contents = querystring.stringify({
    q: wordArr,
    from: orignalLanguage,
    to: descLanguage,
    appKey: appKey,
    salt: salt,
    sign: sign,
    curtime: curtime,
    signType: "v3",
  });

  var options = {
    host: "openapi.youdao.com",
    path: "/v2/api",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": contents.length,
    },
  };
  const requestDelay = (options, contents) =>{
    return new Promise(function(resolve, reject){
      setTimeout(function(){
        request(options, contents).then(result => {
          resolve();
          if (result.errorCode == 411) {
            console.log("翻译频率受限,请稍后访问");
          }
          if (result.translateResults) {
            let translationArr = result.translateResults;
            
            console.table(translationArr.map(item => {
              return {"原文": item.query, "翻译": item.translation}
            }))
            // 翻译完了，生成语言包配置文件
            // 创建翻译的语言源语言和目标语言脚本
            createLanguageScript(filename, translationArr);
            // 把对象转成字符串，同时去掉key的双引号
            fs.writeFile(
              longfilepath + orignalLanguage + ".js",
              "export default" + JSON.stringify(scriptCH_N, " ", 4),
              function (err) {
                if (err) console.log("写文件失败: " + err);
                else console.log("写文件成功");
              }
            );
            fs.writeFile(
              longfilepath + descLanguage + ".js",
              "export default" + JSON.stringify(scriptDESC, " ", 4),
              function (err) {
                if (err) console.log("写文件失败: " + err);
                else console.log("写文件成功");
              }
            );
            // 替换翻译保存文件
            replaceTheTranslateResult(filename, translationArr);
          }
          return;
        }).catch(e => {
          console.log("访问翻译接口失败：" + e);
          reject();
        })
      }, translateDelay * 1000)
    })
  }
  // 请求队列，一个一个来避免出现翻译频率受限
  translateQueue = translateQueue.then(()=>{
        return requestDelay(options, contents)
  })
  // translateQueue = translateQueue.then(()=>{
  //     return request(options, contents)
  //   }).then(result => {
  //     if (result.errorCode == 411) {
  //       console.log("翻译频率受限,请稍后访问");
  //     }
  //     if (result.translateResults) {
  //       let translationArr = result.translateResults;
        
  //       console.table(translationArr.map(item => {
  //         return {"原文": item.query, "翻译": item.translation}
  //       }))
  //       // 翻译完了，生成语言包配置文件
  //       // 创建翻译的语言源语言和目标语言脚本
  //       createLanguageScript(filename, translationArr);
  //       // 把对象转成字符串，同时去掉key的双引号
  //       fs.writeFile(
  //         longfilepath + orignalLanguage + ".js",
  //         "export default" + JSON.stringify(scriptCH_N, " ", 4),
  //         function (err) {
  //           if (err) console.log("写文件失败: " + err);
  //           else console.log("写文件成功");
  //         }
  //       );
  //       fs.writeFile(
  //         longfilepath + descLanguage + ".js",
  //         "export default" + JSON.stringify(scriptDESC, " ", 4),
  //         function (err) {
  //           if (err) console.log("写文件失败: " + err);
  //           else console.log("写文件成功");
  //         }
  //       );
  //       // 替换翻译保存文件
  //       replaceTheTranslateResult(filename, translationArr);
  //     }
  //     return;
  //   }).catch(e => {
  //     console.log("访问翻译接口失败：" + e);
  //   })
}


// 创建翻译的脚本
// scriptCH_N
// scriptDESC
function createLanguageScript(filename, translationArr) {
  // 用文件名和目录获得key
  var filenameArray = filename
    .split("\\")
    .slice(
      filename.split("\\").indexOf("src") + 1,
      filename.split("\\").length
    );
  var wordsSrcObj = {}, wordsDescObj = {};
  filenameArray = filenameArray.map(function (item) {
    return String(item).replace(".vue", "").replace(".js", "");
  });

  // 生成配置文件结构
  if (scriptCH_N.hasOwnProperty("app")) {
    for (var i = 0; i < filenameArray.length; i++) {
      if (i == 0) {
        if (!scriptCH_N.app.hasOwnProperty(filenameArray[i])) {
          scriptCH_N.app[filenameArray[i]] = {};
          scriptDESC.app[filenameArray[i]] = {};
        }
      }
      if (i == 1) {
        if (!(typeof scriptCH_N.app[filenameArray[i - 1]] == "object" && scriptCH_N.app[filenameArray[i - 1]].hasOwnProperty(filenameArray[i]))) {
          scriptCH_N.app[filenameArray[i - 1]][filenameArray[i]] = {};
          scriptDESC.app[filenameArray[i - 1]][filenameArray[i]] = {};
        }
      }

      if (i == 2) {
        if (
          typeof scriptCH_N.app[filenameArray[i - 2]][filenameArray[i - 1]] ==
            "object" &&
          scriptCH_N.app[filenameArray[i - 2]][
            filenameArray[i - 1]
          ].hasOwnProperty(filenameArray[i])
        ) {
          // do something
        } else {
          scriptCH_N.app[filenameArray[i - 2]][filenameArray[i - 1]][
            filenameArray[i]
          ] = {};
          scriptDESC.app[filenameArray[i - 2]][filenameArray[i - 1]][
            filenameArray[i]
          ] = {};
        }
      }

      if (i == 3) {
        if (
          typeof scriptCH_N.app[filenameArray[i - 3]][filenameArray[i - 2]][
            filenameArray[i - 1]
          ] == "object" &&
          scriptCH_N.app[filenameArray[i - 3]][filenameArray[i - 2]][
            filenameArray[i - 1]
          ].hasOwnProperty(filenameArray[i])
        ) {
          // do something
        } else {
          scriptCH_N.app[filenameArray[i - 3]][filenameArray[i - 2]][
            filenameArray[i - 1]
          ][filenameArray[i]] = {};
          scriptDESC.app[filenameArray[i - 3]][filenameArray[i - 2]][
            filenameArray[i - 1]
          ][filenameArray[i]] = {};
        }
      }
    }
  }
  // 生成翻的正文和翻译目标文件的正文
  var keyplist = "";
  // 去除同一个文件中的重复词组
  var obj = {};
  translationArr = translationArr.reduce(function (item, next) {
    obj[next.query] ? "" : (obj[next.query] = true && item.push(next));
    return item;
  }, []);
  translationArr.sort(function (value1, value2) {
    if (value1.query.length > value2.query.length) {
      return -1;
    } else if (value1.query.length < value2.query.length) {
      return 1;
    } else {
      return 0;
    }
  });

  for (var j = 0; j < translationArr.length; j++) {
    keyplist = toCamelCase(translationArr[j].translation);
    wordsSrcObj[keyplist] = translationArr[j].query;
    wordsDescObj[keyplist] = translationArr[j].translation;
    // 记录生成的key
    translationArr[j].key = "app." + filenameArray.join(".") + "." + keyplist;
  }

  if (filenameArray.length == 1) {
    scriptCH_N.app[filenameArray[0]] = wordsSrcObj;
    scriptDESC.app[filenameArray[0]] = wordsDescObj;
  } else if (filenameArray.length == 2) {
    scriptCH_N.app[filenameArray[0]][filenameArray[1]] = wordsSrcObj;
    scriptDESC.app[filenameArray[0]][filenameArray[1]] = wordsDescObj;
  } else if (filenameArray.length == 3) {
    scriptCH_N.app[filenameArray[0]][filenameArray[1]][filenameArray[2]] =
      wordsSrcObj;
    scriptDESC.app[filenameArray[0]][filenameArray[1]][filenameArray[2]] =
      wordsDescObj;
  } else if (filenameArray.length == 4) {
    scriptCH_N.app[filenameArray[0]][filenameArray[1]][filenameArray[2]][
      filenameArray[3]
    ] = wordsSrcObj;
    scriptDESC.app[filenameArray[0]][filenameArray[1]][filenameArray[2]][
      filenameArray[3]
    ] = wordsDescObj;
  }
}

// 替换翻译保存文件
function replaceTheTranslateResult(filename, translationArr) {
  let filecontent = fs.readFileSync(filename, "utf8");
  // 将wordlist的汉字按照文字长度排序 防止某些东西呗
  translationArr.sort(function (value1, value2) {
    return value2.query.length - value1.query.length;
  });

  // 替换源文件中翻译的文字vue iin18 2种格式
  // 模板中的使用 {{$t(data.key)}} 替换
  // js脚本文件中的试用 this.$t('data.key') 替换
  translationArr.forEach(function (data) {
    // vue文件
    if (filename.indexOf(".vue")) {
      var wordsoffset = 0;
      while ( (wordsoffset = filecontent.indexOf(data.query, wordsoffset + 1)) != -1 ) {
        // 如果是<template>标签内
        if ( wordsoffset > filecontent.indexOf("<template>") && wordsoffset < filecontent.indexOf("</template>") ) {
          // 判断替换内容是节点上的属性还是标签内的内容
          if (filecontent.lastIndexOf(">", wordsoffset) + 10 > wordsoffset) {
            filecontent = filecontent.replace( data.query, "{{$t('" + data.key + "')}}" );
          } else {
            // 内容替换
            // let reg = new RegExp("[\'\"]" + data.query + "[\'\"]","gim");
            // filecontent = filecontent.replace(reg, "$t('" + data.key + "')" );
            filecontent = filecontent.replace(data.query, "$t(`" + data.key + "`)" );
          }
        }
        // 如果在script标签中
        if ( wordsoffset > filecontent.indexOf("<script>") && wordsoffset < filecontent.indexOf("</script>") ) {
          filecontent = filecontent.replace( '"' + data.query + '"', "this.$t('" + data.key + "')" );
          filecontent = filecontent.replace( "'" + data.query + "'", "this.$t('" + data.key + "')" );
        }
      }
    } else {
      // js文件
      // 在js文件中修改 全局替换  代码中一种是单引号，一种是双引号
      var reg = new RegExp('"' + data.query + '"', "g");
      filecontent = filecontent.replace(reg, "this.$t('" + data.key + "')");
      reg = new RegExp("'" + data.query + "'", "g");
      filecontent = filecontent.replace(reg, "this.$t('" + data.key + "')");
    }
  });

  fs.writeFile(filename, filecontent, function (err) {
    if (err) console.log("修改失败");
    else console.log(filename + "修改成功");
  });
}


// 封装request
function request(_options, _contents){
  return new Promise(function(resolve, reject){
    let req = http.request(_options, function (res) {
      let result = "";
      res.setEncoding("utf8");
      res.on("data", function (chuck) {
        if(chuck) result+=chuck;
      }).on("end", function(){
        resolve(JSON.parse(result))
      })
    })
    req.on('error',function(e){ //响应出错调用函数
      reject('错误为：'+e.message);
    });
    req.write(_contents);
    req.end;
  })
}

function truncate(q) {
  var len = q.length;
  if (len <= 20) return q;
  return q.substring(0, 10) + len + q.substring(len - 10, len);
}

//用于生成uuid
function S4() {
  return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
}

function guid() {
  return (
    S4() +
    S4() +
    "-" +
    S4() +
    "-" +
    S4() +
    "-" +
    S4() +
    "-" +
    S4() +
    S4() +
    S4()
  );
}

function toCamelCase(str) {
  try {
    let wordArr = str.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g);
    if (wordArr) {
      let s = wordArr.map(x => x.slice(0, 1).toUpperCase() + x.slice(1).toLowerCase()).join('');
      return s.slice(0, 1).toLowerCase() + s.slice(1);
    } else {
      return str;
    }
  } catch (error) {
    console.error("错误单词：" + str)
  }
}