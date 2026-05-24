// mobile/lib/widgets/video_player_widget.dart
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

class VideoPlayerWidget extends StatefulWidget {
  final String videoUrl;
  
  const VideoPlayerWidget({super.key, required this.videoUrl});

  @override
  State<VideoPlayerWidget> createState() => _VideoPlayerWidgetState();
}

class _VideoPlayerWidgetState extends State<VideoPlayerWidget> {
  late VideoPlayerController _controller;
  bool _isInitialized = false;
  bool _isPlaying = false;

  @override
  void initState() {
    super.initState();
    _initializeVideo();
  }

  Future<void> _initializeVideo() async {
    try {
      String fullUrl = widget.videoUrl;
      if (!fullUrl.startsWith('http') && fullUrl.startsWith('/uploads/')) {
        fullUrl = 'http://localhost:8080$fullUrl';
      }
      
      debugPrint('🎬 Chargement vidéo: $fullUrl');
      
      _controller = VideoPlayerController.networkUrl(Uri.parse(fullUrl));
      await _controller.initialize();
      
      if (mounted) {
        setState(() {
          _isInitialized = true;
        });
        // Jouer automatiquement
        _controller.play();
        setState(() {
          _isPlaying = true;
        });
      }
    } catch (e) {
      debugPrint('❌ Erreur initialisation vidéo: $e');
      if (mounted) {
        setState(() {
          _isInitialized = false;
        });
      }
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_isInitialized) {
      return Container(
        height: 200,
        color: Colors.black,
        child: const Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircularProgressIndicator(color: Colors.white),
              SizedBox(height: 16),
              Text(
                'Chargement de la vidéo...',
                style: TextStyle(color: Colors.white),
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Vidéo avec taille fixe
        Container(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.4,
          ),
          child: AspectRatio(
            aspectRatio: _controller.value.aspectRatio,
            child: VideoPlayer(_controller),
          ),
        ),
        // Contrôles
        Container(
          padding: const EdgeInsets.all(8),
          decoration: const BoxDecoration(
            color: Colors.black87,
            borderRadius: BorderRadius.only(
              bottomLeft: Radius.circular(12),
              bottomRight: Radius.circular(12),
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(
                icon: Icon(
                  _isPlaying ? Icons.pause : Icons.play_arrow,
                  size: 30,
                  color: Colors.white,
                ),
                onPressed: () {
                  setState(() {
                    if (_controller.value.isPlaying) {
                      _controller.pause();
                      _isPlaying = false;
                    } else {
                      _controller.play();
                      _isPlaying = true;
                    }
                  });
                },
              ),
              const SizedBox(width: 20),
              IconButton(
                icon: const Icon(Icons.replay, size: 25, color: Colors.white),
                onPressed: () {
                  _controller.seekTo(Duration.zero);
                  _controller.play();
                  setState(() {
                    _isPlaying = true;
                  });
                },
              ),
              const SizedBox(width: 20),
              IconButton(
                icon: const Icon(Icons.close, size: 25, color: Colors.white),
                onPressed: () {
                  Navigator.pop(context);
                },
              ),
            ],
          ),
        ),
      ],
    );
  }
}