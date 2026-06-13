# TecCapture
特定の特化した技術がないと解けないキャプチャを提供します。

# 導入方法
app.pyをサーバーでホストし、導入したいサーバーで「capture.js」を使ってフォームに組み込むだけです。<br>
また、出される問題は、「data.json」に記入し、以下のように入力してください。<br>
```json
{
    // 技術名
    "python": [
        // 問題一覧
        {
            "question": "Pythonでリストの長さを返す関数は？",
            "correct": "len",
            "wrong": ["print", "raise", "random.choice"],
            "hint": "文字列にも使えます。"
        },
        {
            "question": "Pythonでリストを結合する方法は？",
            "correct": "リストとリストを+で足す",
            "wrong": ["リストとリストを-で足す", "リストとリストを*で掛ける", "リストを*2する"],
            "hint": "文字列にも使えます。"
        }
    ]
}
```