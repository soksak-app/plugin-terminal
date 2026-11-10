# 터미널 plugin

`terminal.screen` watch는 첫 read 전에 semantic PTY 화면 변경을 구독한다. native image가 그리지 않거나 raster copy가 대기 중이어도 engine 출력은 관찰 중인 cells를 무효화하며, 기존 read 병합이 read 도중 변경에 후속 read 하나를 유지한다. 첫 watcher가 `screen.watch`를 켜고 마지막 watcher는 한 번 끄며 재연결은 새 read 전에 복원하고 dispose·abort는 해제한다. watcher가 없는 surface는 semantic 알림을 요청하지 않는다. `screen.changed`는 raster·presentation을 증명하지 않는다. 등록은 고유한 기존 wire CID에 맞는 `screen.watching` 확인 응답을 기다리며 전송 완료만으로 첫 read를 시작하지 않는다. 거부·전송 실패·surface의 `sidecar-failure`는 기존 session 오류 상태로 보고한다. 대기 중인 전환에는 시간 한도가 없고, 확인 응답·거부·전송 실패·대체·connection event·exit·surface의 `sidecar-failure`·view의 닫힘이 그것을 끝낸다. 늦은 CID는 끝난 등록을 복원하지 못한다.

[English](README.md)

Plugin 형식은 soksak core spec(`docs/spec/plugins.md`)이 정한다.

```sh
make test                                   # test
make check                                  # event source check와 document 검사
make pack OUT=<folder> # plugin release
make install-hooks                                  # clone 후 한 번: commit 때 commit message와 record를 검사
```

`make check`는 `package.json`이 pin한 kit의 event source 검사와 document 검사를 실행한다. application은 release를 설치할 때 `plugin.json`을 검증하고, registry 검사는 release의 exposed 이름을 각 listed core의 선언과 비교한다.

Checklist는 [docs/features.md](docs/features.md)다.
