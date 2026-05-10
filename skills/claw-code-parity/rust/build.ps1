$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
& 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat' x64
cargo build --release
