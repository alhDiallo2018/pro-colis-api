// mobile/lib/screens/parcel/new_parcel_screen.dart
import 'dart:io';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:video_player/video_player.dart';

import '../../models/garage.dart';
import '../../models/parcel.dart';
import '../../models/user.dart';
import '../../providers/auth_provider.dart';
import '../../providers/parcel_provider.dart';
import '../../services/api_service.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';
import 'parcel_detail_screen.dart';

class NewParcelScreen extends ConsumerStatefulWidget {
  const NewParcelScreen({super.key});

  @override
  ConsumerState<NewParcelScreen> createState() => _NewParcelScreenState();
}

class _NewParcelScreenState extends ConsumerState<NewParcelScreen> {
  final ApiService _apiService = ApiService();
  final _formKey = GlobalKey<FormState>();
  
  // Liste des garages depuis l'API
  List<Garage> _garages = [];
  bool _isLoadingGarages = true;
  
  // Destinataire
  final _receiverNameController = TextEditingController();
  final _receiverPhoneController = TextEditingController();
  final _receiverEmailController = TextEditingController();
  
  // Colis
  final _descriptionController = TextEditingController();
  final _weightController = TextEditingController();
  final _priceController = TextEditingController();
  ParcelType _selectedType = ParcelType.package;
  
  // Lieux
  String? _selectedDepartureGarageId;
  String? _selectedArrivalGarageId;
  
  // Chauffeur
  String? _selectedDriverId;
  List<User> _availableDrivers = [];
  bool _isSearchingDrivers = false;
  final TextEditingController _driverSearchController = TextEditingController();
  
  bool _isLoading = false;
  bool _urgentDelivery = false;
  bool _insurance = false;
  
  // Médias - Support Web et Mobile
  final List<XFile> _photos = [];
  final List<XFile> _videos = [];
  final ImagePicker _picker = ImagePicker();
  
  // URLs uploadées
  List<String> _uploadedPhotoUrls = [];
  List<String> _uploadedVideoUrls = [];
  
  // Contrôleurs vidéo pour mobile
  final Map<String, VideoPlayerController> _videoControllers = {};
  final Map<String, bool> _videoInitialized = {};

  @override
  void initState() {
    super.initState();
    _loadGarages();
    _loadAvailableDrivers();
  }

  @override
  void dispose() {
    _receiverNameController.dispose();
    _receiverPhoneController.dispose();
    _receiverEmailController.dispose();
    _descriptionController.dispose();
    _weightController.dispose();
    _priceController.dispose();
    _driverSearchController.dispose();
    for (var controller in _videoControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _loadGarages() async {
    setState(() {
      _isLoadingGarages = true;
    });
    
    try {
      final garages = await _apiService.getAllGarages();
      setState(() {
        _garages = garages;
        _isLoadingGarages = false;
      });
      debugPrint('✅ ${garages.length} garages chargés depuis l\'API');
    } catch (e) {
      setState(() {
        _isLoadingGarages = false;
      });
      debugPrint('❌ Erreur chargement garages: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur chargement garages: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _loadAvailableDrivers() async {
    setState(() {
      _isSearchingDrivers = true;
    });
    
    try {
      final drivers = await _apiService.searchDriversPublic();
      setState(() {
        _availableDrivers = drivers;
        _isSearchingDrivers = false;
      });
      debugPrint('✅ ${drivers.length} chauffeurs chargés via API publique');
    } catch (e) {
      debugPrint('❌ Erreur chargement chauffeurs: $e');
      setState(() {
        _availableDrivers = [];
        _isSearchingDrivers = false;
      });
    }
  }

  Future<void> _searchDriver() async {
    final query = _driverSearchController.text.trim();
    
    if (query.isEmpty) {
      await _loadAvailableDrivers();
      return;
    }
    
    setState(() {
      _isSearchingDrivers = true;
    });
    
    try {
      final drivers = await _apiService.searchDriversPublic(query: query);
      
      setState(() {
        _availableDrivers = drivers;
        _isSearchingDrivers = false;
      });
      debugPrint('✅ ${drivers.length} chauffeurs trouvés pour la recherche: $query');
    } catch (e) {
      debugPrint('❌ Erreur recherche chauffeur: $e');
      setState(() {
        _isSearchingDrivers = false;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur recherche: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  // ==================== GESTION DES PHOTOS ====================
  
  Future<void> _pickPhoto() async {
    try {
      final XFile? photo = await _picker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 80,
      );
      if (photo != null) {
        setState(() {
          _photos.add(photo);
        });
      }
    } catch (e) {
      debugPrint('Erreur lors de la sélection de la photo: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _takePhoto() async {
    try {
      final XFile? photo = await _picker.pickImage(
        source: ImageSource.camera,
        imageQuality: 80,
      );
      if (photo != null) {
        setState(() {
          _photos.add(photo);
        });
      }
    } catch (e) {
      debugPrint('Erreur lors de la prise de photo: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _pickVideo() async {
    try {
      final XFile? video = await _picker.pickVideo(
        source: ImageSource.gallery,
      );
      if (video != null) {
        setState(() {
          _videos.add(video);
          if (!kIsWeb) {
            _initializeVideoController(video);
          }
        });
      }
    } catch (e) {
      debugPrint('Erreur lors de la sélection de la vidéo: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _recordVideo() async {
    try {
      final XFile? video = await _picker.pickVideo(
        source: ImageSource.camera,
      );
      if (video != null) {
        setState(() {
          _videos.add(video);
          if (!kIsWeb) {
            _initializeVideoController(video);
          }
        });
      }
    } catch (e) {
      debugPrint('Erreur lors de l\'enregistrement vidéo: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _initializeVideoController(XFile video) async {
    if (kIsWeb) return;
    
    final controller = VideoPlayerController.file(File(video.path));
    await controller.initialize();
    if (mounted) {
      setState(() {
        _videoControllers[video.path] = controller;
        _videoInitialized[video.path] = true;
      });
    }
  }

  void _removePhoto(int index) {
    setState(() {
      _photos.removeAt(index);
    });
  }

  void _removeVideo(int index) {
    final videoPath = _videos[index].path;
    setState(() {
      _videos.removeAt(index);
    });
    if (!kIsWeb) {
      _videoControllers[videoPath]?.dispose();
      _videoControllers.remove(videoPath);
      _videoInitialized.remove(videoPath);
    }
  }

  // ==================== AFFICHAGE DES MÉDIAS ====================
  
  Widget _buildMediaSection() {
    return _buildSection(
      icon: Icons.photo_library,
      title: 'Photos et vidéos',
      color: Colors.teal,
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: _buildMediaButton(
                  icon: Icons.photo_library,
                  label: 'Galerie photo',
                  onTap: _pickPhoto,
                  color: Colors.blue,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildMediaButton(
                  icon: Icons.camera_alt,
                  label: 'Appareil photo',
                  onTap: _takePhoto,
                  color: Colors.green,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _buildMediaButton(
                  icon: Icons.video_library,
                  label: 'Galerie vidéo',
                  onTap: _pickVideo,
                  color: Colors.orange,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildMediaButton(
                  icon: Icons.videocam,
                  label: 'Enregistrer',
                  onTap: _recordVideo,
                  color: Colors.red,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          
          if (_photos.isNotEmpty) ...[
            const Text('Photos', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            SizedBox(
              height: 100,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: _photos.length,
                itemBuilder: (context, index) {
                  return _buildPhotoThumbnail(_photos[index], index);
                },
              ),
            ),
            const SizedBox(height: 12),
          ],
          
          if (_videos.isNotEmpty) ...[
            const Text('Vidéos', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            SizedBox(
              height: 100,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: _videos.length,
                itemBuilder: (context, index) {
                  return _buildVideoThumbnail(_videos[index], index);
                },
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildMediaButton({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    required Color color,
  }) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 18, color: color),
      label: Text(label, style: TextStyle(color: color)),
      style: OutlinedButton.styleFrom(
        side: BorderSide(color: color),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    );
  }

  Widget _buildPhotoThumbnail(XFile photo, int index) {
    return Stack(
      children: [
        Container(
          margin: const EdgeInsets.only(right: 8),
          width: 100,
          height: 100,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            image: DecorationImage(
              image: _getImageProvider(photo.path),
              fit: BoxFit.cover,
            ),
          ),
        ),
        Positioned(
          top: 4,
          right: 4,
          child: GestureDetector(
            onTap: () => _removePhoto(index),
            child: Container(
              decoration: BoxDecoration(
                color: Colors.black.withAlpha(150),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.close, size: 20, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildVideoThumbnail(XFile video, int index) {
    final isInitialized = _videoInitialized[video.path] ?? false;
    final controller = _videoControllers[video.path];
    
    return Stack(
      children: [
        Container(
          margin: const EdgeInsets.only(right: 8),
          width: 100,
          height: 100,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            color: Colors.black,
          ),
          child: Center(
            child: !kIsWeb && isInitialized && controller != null
                ? Stack(
                    children: [
                      VideoPlayer(controller),
                      Center(
                        child: Container(
                          decoration: BoxDecoration(
                            color: Colors.black.withAlpha(100),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.play_arrow,
                            size: 30,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ],
                  )
                : Stack(
                    children: [
                      Image.network(
                        video.path,
                        width: 100,
                        height: 100,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) {
                          return Container(
                            color: Colors.grey[900],
                            child: const Icon(Icons.videocam, size: 40, color: Colors.white54),
                          );
                        },
                      ),
                      Center(
                        child: Container(
                          decoration: BoxDecoration(
                            color: Colors.black.withAlpha(100),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.play_arrow,
                            size: 30,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ),
          ),
        ),
        Positioned(
          top: 4,
          right: 4,
          child: GestureDetector(
            onTap: () => _removeVideo(index),
            child: Container(
              decoration: BoxDecoration(
                color: Colors.black.withAlpha(150),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.close, size: 20, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }

  ImageProvider _getImageProvider(String path) {
    if (kIsWeb) {
      return NetworkImage(path);
    } else {
      return FileImage(File(path));
    }
  }

  // ==================== SECTION CHAUFFEUR ====================
  
  Widget _buildDriverSection() {
    final authState = ref.watch(authProvider);
    final isClient = authState.user?.role == UserRole.client;
    
    if (!isClient) {
      return const SizedBox.shrink();
    }
    
    return _buildSection(
      icon: Icons.delivery_dining,
      title: 'Choisir un chauffeur (optionnel)',
      color: Colors.amber,
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: Colors.blue.withAlpha(25),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Row(
              children: [
                Icon(Icons.info, size: 16, color: Colors.blue),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Si vous ne choisissez pas de chauffeur, l\'administration du garage vous en assignera un automatiquement.',
                    style: TextStyle(fontSize: 12, color: Colors.blue),
                  ),
                ),
              ],
            ),
          ),
          
          Row(
            children: [
              Expanded(
                child: CustomTextField(
                  controller: _driverSearchController,
                  label: 'Rechercher par ID, Email ou Téléphone',
                  prefixIcon: Icons.search,
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                icon: const Icon(Icons.search),
                onPressed: _searchDriver,
                color: const Color(0xFF0B6E3A),
              ),
            ],
          ),
          const SizedBox(height: 12),
          
          if (_isSearchingDrivers)
            const Center(child: CircularProgressIndicator())
          else if (_availableDrivers.isEmpty)
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Aucun chauffeur trouvé'),
            )
          else
            Container(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.of(context).size.height * 0.4,
              ),
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: _availableDrivers.length,
                itemBuilder: (context, index) {
                  final driver = _availableDrivers[index];
                  final isSelected = _selectedDriverId == driver.id;
                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    color: isSelected ? Colors.green.withAlpha(25) : null,
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: isSelected ? Colors.green : Colors.grey,
                        child: const Icon(Icons.person, color: Colors.white),
                      ),
                      title: Text(
                        driver.fullName,
                        style: TextStyle(
                          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                      subtitle: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('ID: ${driver.id.substring(0, 8)}...'),
                          Text('Email: ${driver.email}'),
                          Text('Tél: ${driver.phone}'),
                          if (driver.vehiclePlate != null)
                            Text('Véhicule: ${driver.vehiclePlate}'),
                        ],
                      ),
                      trailing: isSelected
                          ? const Icon(Icons.check_circle, color: Colors.green)
                          : const Icon(Icons.radio_button_unchecked),
                      onTap: () {
                        setState(() {
                          _selectedDriverId = driver.id;
                        });
                      },
                    ),
                  );
                },
              ),
            ),
          
          if (_selectedDriverId != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.green.withAlpha(25),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  const Icon(Icons.check_circle, color: Colors.green),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Chauffeur sélectionné: ${_availableDrivers.firstWhere((d) => d.id == _selectedDriverId).fullName}',
                      style: const TextStyle(color: Colors.green),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  // ==================== UPLOAD DES MÉDIAS ====================
  
  Future<List<String>> _uploadPhotos() async {
    List<String> uploadedUrls = [];
    
    for (var photo in _photos) {
      try {
        final url = await _apiService.uploadParcelPhoto(photo, 'temp');
        if (url != null) {
          uploadedUrls.add(url);
          debugPrint('✅ Photo uploadée: $url');
        }
      } catch (e) {
        debugPrint('❌ Erreur upload photo: $e');
      }
    }
    
    return uploadedUrls;
  }
  
  Future<List<String>> _uploadVideos() async {
    List<String> uploadedUrls = [];
    
    for (var video in _videos) {
      try {
        final url = await _apiService.uploadParcelVideo(video, 'temp');
        if (url != null) {
          uploadedUrls.add(url);
          debugPrint('✅ Vidéo uploadée: $url');
        }
      } catch (e) {
        debugPrint('❌ Erreur upload vidéo: $e');
      }
    }
    
    return uploadedUrls;
  }

  // ==================== CRÉATION DU COLIS ====================
  
  Future<void> _createParcel() async {
    if (!_formKey.currentState!.validate()) return;
    
    if (_selectedDepartureGarageId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Veuillez sélectionner un garage de départ'), backgroundColor: Colors.orange),
      );
      return;
    }
    
    setState(() => _isLoading = true);
    
    try {
      // 1. Uploader les photos
      final photoUrls = await _uploadPhotos();
      
      // 2. Uploader les vidéos
      final videoUrls = await _uploadVideos();
      
      final departureGarage = _garages.firstWhere((g) => g.id == _selectedDepartureGarageId);
      final arrivalGarage = _selectedArrivalGarageId != null 
          ? _garages.firstWhere((g) => g.id == _selectedArrivalGarageId)
          : departureGarage;
      
      User? selectedDriver;
      if (_selectedDriverId != null) {
        selectedDriver = _availableDrivers.firstWhere(
          (d) => d.id == _selectedDriverId,
          orElse: () => throw Exception('Chauffeur non trouvé'),
        );
      }
      
      final data = {
        'receiverName': _receiverNameController.text.trim(),
        'receiverPhone': _receiverPhoneController.text.trim(),
        'receiverEmail': _receiverEmailController.text.trim().isEmpty ? null : _receiverEmailController.text.trim(),
        'description': _descriptionController.text.trim(),
        'weight': double.parse(_weightController.text),
        'type': _selectedType.value,
        'departureGarageId': _selectedDepartureGarageId,
        'departureGarageName': departureGarage.name,
        'arrivalGarageId': _selectedArrivalGarageId,
        'arrivalGarageName': arrivalGarage.name,
        'price': double.tryParse(_priceController.text) ?? 0,
        'isUrgent': _urgentDelivery,
        'isInsured': _insurance,
        'photoUrls': photoUrls,
        'videoUrls': videoUrls,
        'driverId': selectedDriver?.id,
        'driverName': selectedDriver?.fullName,
        'driverPhone': selectedDriver?.phone,
      };
      
      final result = await ref.read(parcelProvider.notifier).createParcel(data);
      
      if (mounted) {
        setState(() => _isLoading = false);
      }
      
      if (result != null && mounted) {
        _navigateToParcelDetail(result);
      } else if (mounted) {
        final errorState = ref.read(parcelProvider);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(errorState.error ?? 'Erreur lors de la création du colis'), backgroundColor: Colors.red),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _navigateToParcelDetail(Parcel parcel) {
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (context) => ParcelDetailScreen(parcel: parcel),
      ),
      (route) => route.isFirst,
    );
  }

  void _resetForm() {
    _receiverNameController.clear();
    _receiverPhoneController.clear();
    _receiverEmailController.clear();
    _descriptionController.clear();
    _weightController.clear();
    _priceController.clear();
    _driverSearchController.clear();
    setState(() {
      _selectedType = ParcelType.package;
      _selectedDepartureGarageId = null;
      _selectedArrivalGarageId = null;
      _selectedDriverId = null;
      _urgentDelivery = false;
      _insurance = false;
      _photos.clear();
      _videos.clear();
      _uploadedPhotoUrls.clear();
      _uploadedVideoUrls.clear();
    });
    _loadAvailableDrivers();
    if (!kIsWeb) {
      for (var controller in _videoControllers.values) {
        controller.dispose();
      }
      _videoControllers.clear();
      _videoInitialized.clear();
    }
  }

  // ==================== BUILD ====================

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Nouveau colis'),
        backgroundColor: const Color(0xFF0B6E3A),
        foregroundColor: Colors.white,
      ),
      body: _isLoadingGarages
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Section Destinataire
                    _buildSection(
                      icon: Icons.person,
                      title: 'Destinataire',
                      color: Colors.blue,
                      child: Column(
                        children: [
                          CustomTextField(
                            controller: _receiverNameController,
                            label: 'Nom complet',
                            prefixIcon: Icons.person,
                            validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
                          ),
                          const SizedBox(height: 12),
                          CustomTextField(
                            controller: _receiverPhoneController,
                            label: 'Téléphone',
                            prefixIcon: Icons.phone,
                            keyboardType: TextInputType.phone,
                            validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
                          ),
                          const SizedBox(height: 12),
                          CustomTextField(
                            controller: _receiverEmailController,
                            label: 'Email (optionnel)',
                            prefixIcon: Icons.email,
                            keyboardType: TextInputType.emailAddress,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    
                    // Section Colis
                    _buildSection(
                      icon: Icons.inventory,
                      title: 'Informations colis',
                      color: Colors.green,
                      child: Column(
                        children: [
                          CustomTextField(
                            controller: _descriptionController,
                            label: 'Description',
                            prefixIcon: Icons.description,
                            maxLines: 3,
                            validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
                          ),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              Expanded(
                                child: CustomTextField(
                                  controller: _weightController,
                                  label: 'Poids (kg)',
                                  prefixIcon: Icons.fitness_center,
                                  keyboardType: TextInputType.number,
                                  validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: CustomTextField(
                                  controller: _priceController,
                                  label: 'Prix (FCFA)',
                                  prefixIcon: Icons.money,
                                  keyboardType: TextInputType.number,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          DropdownButtonFormField<ParcelType>(
                            initialValue: _selectedType,
                            decoration: const InputDecoration(
                              labelText: 'Type de colis',
                              prefixIcon: Icon(Icons.category),
                              border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                            ),
                            items: ParcelType.values.map((type) => DropdownMenuItem(
                              value: type,
                              child: Row(
                                children: [
                                  Icon(_getTypeIcon(type), size: 18),
                                  const SizedBox(width: 8),
                                  Text(type.label),
                                ],
                              ),
                            )).toList(),
                            onChanged: (value) => setState(() => _selectedType = value!),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    
                    // Section Trajet
                    _buildSection(
                      icon: Icons.route,
                      title: 'Trajet',
                      color: Colors.orange,
                      child: Column(
                        children: [
                          DropdownButtonFormField<String>(
                            initialValue: _selectedDepartureGarageId,
                            hint: const Text('Sélectionnez le garage de départ'),
                            decoration: const InputDecoration(
                              labelText: 'Garage départ',
                              prefixIcon: Icon(Icons.departure_board),
                              border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                            ),
                            items: _garages.map((garage) => DropdownMenuItem(
                              value: garage.id,
                              child: Text('${garage.name} - ${garage.city}'),
                            )).toList(),
                            onChanged: (value) => setState(() => _selectedDepartureGarageId = value),
                            validator: (v) => v == null ? 'Champ requis' : null,
                          ),
                          const SizedBox(height: 12),
                          DropdownButtonFormField<String?>(
                            initialValue: _selectedArrivalGarageId,
                            hint: const Text('Sélectionnez le garage d\'arrivée (optionnel)'),
                            decoration: const InputDecoration(
                              labelText: 'Garage arrivée',
                              prefixIcon: Icon(Icons.location_on),
                              border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                            ),
                            items: [
                              const DropdownMenuItem(value: null, child: Text('Aucun (même garage)')),
                              ..._garages.map((garage) => DropdownMenuItem(
                                value: garage.id,
                                child: Text('${garage.name} - ${garage.city}'),
                              )),
                            ],
                            onChanged: (value) => setState(() => _selectedArrivalGarageId = value),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    
                    // Section Chauffeur
                    _buildDriverSection(),
                    const SizedBox(height: 16),
                    
                    // Section Médias
                    _buildMediaSection(),
                    const SizedBox(height: 16),
                    
                    // Section Options
                    _buildSection(
                      icon: Icons.settings,
                      title: 'Options',
                      color: Colors.purple,
                      child: Column(
                        children: [
                          SwitchListTile(
                            title: const Text('Livraison urgente'),
                            subtitle: const Text('Priorité + 500 FCFA'),
                            value: _urgentDelivery,
                            onChanged: (value) => setState(() => _urgentDelivery = value),
                            activeTrackColor: const Color(0xFF0B6E3A).withAlpha(128),
                            activeThumbColor: const Color(0xFF0B6E3A),
                            contentPadding: EdgeInsets.zero,
                          ),
                          SwitchListTile(
                            title: const Text('Assurance colis'),
                            subtitle: const Text('Protection jusqu\'à 50 000 FCFA'),
                            value: _insurance,
                            onChanged: (value) => setState(() => _insurance = value),
                            activeTrackColor: const Color(0xFF0B6E3A).withAlpha(128),
                            activeThumbColor: const Color(0xFF0B6E3A),
                            contentPadding: EdgeInsets.zero,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 32),
                    CustomButton(
                      text: 'Créer le colis',
                      onPressed: _createParcel,
                      isLoading: _isLoading,
                    ),
                    const SizedBox(height: 16),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildSection({
    required IconData icon,
    required String title,
    required Color color,
    required Widget child,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withAlpha(25),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color),
              const SizedBox(width: 8),
              Text(title, style: TextStyle(fontWeight: FontWeight.bold, color: color)),
            ],
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }

  IconData _getTypeIcon(ParcelType type) {
    switch (type) {
      case ParcelType.document:
        return Icons.description;
      case ParcelType.package:
        return Icons.inventory;
      case ParcelType.fragile:
        return Icons.science;
      case ParcelType.perishable:
        return Icons.eco;
      case ParcelType.valuable:
        return Icons.attach_money;
    }
  }
}